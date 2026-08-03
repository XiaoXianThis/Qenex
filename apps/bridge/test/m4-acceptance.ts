/**
 * Live M4 acceptance: SQLite persistence across Bridge restart,
 * message history API, title, delete-forbids-chat.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridgeServer } from "../src/server.ts";

const workspace = mkdtempSync(join(tmpdir(), "qenex-m4-ws-"));
const dbDir = mkdtempSync(join(tmpdir(), "qenex-m4-db-"));
const dbPath = join(dbDir, "sessions.db");

function reconstructText(sse: string): string {
  const deltas: string[] = [];
  for (const line of sse.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload) as {
        type?: string;
        delta?: string;
        text?: string;
      };
      if (evt.type === "text-delta") {
        deltas.push(String(evt.delta ?? evt.text ?? ""));
      }
    } catch {
      /* ignore */
    }
  }
  return deltas.join("");
}

async function createSession(
  baseUrl: string,
  cwd: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const body = (await response.json()) as {
    sessionId?: string;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || !body.sessionId) {
    throw new Error(`create failed: ${JSON.stringify(body)}`);
  }
  return body.sessionId;
}

async function chat(
  baseUrl: string,
  sessionId: string,
  text: string,
  prior: Array<{ id: string; role: string; parts: unknown[] }> = [],
): Promise<string> {
  const userId = `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const messages = [
    ...prior,
    { id: userId, role: "user", parts: [{ type: "text", text }] },
  ];
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qenex-session-id": sessionId,
    },
    body: JSON.stringify({
      sessionId,
      approvalMode: "auto",
      messages,
    }),
  });
  const sse = await response.text();
  if (!response.ok) {
    throw new Error(`chat failed (${response.status}): ${sse.slice(0, 400)}`);
  }
  return sse;
}

try {
  console.log("[m4] dbPath", dbPath);

  // --- first Bridge process ---
  const server1 = startBridgeServer({
    hostname: "127.0.0.1",
    port: 0,
    dbPath,
  });
  console.log("[m4] server1", server1.url);

  const sessionId = await createSession(server1.url, workspace);
  console.log("[m4] created", sessionId);

  const marker = `M4_MARKER_${Date.now()}`;
  const sse1 = await chat(
    server1.url,
    sessionId,
    `Reply with exactly one word: ${marker}`,
  );
  const text1 = reconstructText(sse1);
  if (!text1.toLowerCase().includes("m4_marker") && !text1.includes(marker)) {
    // Model may paraphrase; require non-empty assistant text at least.
    if (!text1.trim()) {
      throw new Error(`empty chat response: ${sse1.slice(0, 500)}`);
    }
  }
  console.log("[m4] chat1 text length", text1.length);

  const hist1 = await fetch(
    `${server1.url}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  const hist1Body = (await hist1.json()) as {
    messages?: Array<{ role: string; parts?: unknown[] }>;
  };
  if (!hist1.ok || !Array.isArray(hist1Body.messages) || hist1Body.messages.length < 2) {
    throw new Error(`expected persisted messages, got ${JSON.stringify(hist1Body)}`);
  }
  console.log("[m4] persisted message count", hist1Body.messages.length);

  const patch = await fetch(
    `${server1.url}/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "M4 Title" }),
    },
  );
  const patched = (await patch.json()) as { title?: string };
  if (!patch.ok || patched.title !== "M4 Title") {
    throw new Error(`title patch failed: ${JSON.stringify(patched)}`);
  }
  console.log("[m4] title patch ok");

  // Keep DB; dispose ACP only.
  server1.stop();
  if (!existsSync(dbPath)) {
    throw new Error("sessions.db missing after stop()");
  }
  console.log("[m4] server1 stopped; db retained");

  // --- second Bridge process, same db ---
  const server2 = startBridgeServer({
    hostname: "127.0.0.1",
    port: 0,
    dbPath,
  });
  console.log("[m4] server2", server2.url);

  const listed = await fetch(`${server2.url}/api/sessions`);
  const listedBody = (await listed.json()) as {
    sessions?: Array<{ sessionId: string; title?: string | null }>;
  };
  const found = listedBody.sessions?.find((s) => s.sessionId === sessionId);
  if (!found) {
    throw new Error(`session missing after restart: ${JSON.stringify(listedBody)}`);
  }
  if (found.title !== "M4 Title") {
    throw new Error(`title not restored: ${JSON.stringify(found)}`);
  }
  console.log("[m4] list after restart ok");

  const hist2 = await fetch(
    `${server2.url}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  const hist2Body = (await hist2.json()) as {
    messages?: Array<{ id: string; role: string; parts?: unknown[] }>;
  };
  if (
    !hist2.ok ||
    !hist2Body.messages ||
    hist2Body.messages.length !== hist1Body.messages!.length
  ) {
    throw new Error(
      `history mismatch after restart: ${JSON.stringify(hist2Body)}`,
    );
  }
  console.log("[m4] history after restart ok");

  // Soft GET must not require live ACP — already worked via list/messages.
  const getInfo = await fetch(
    `${server2.url}/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  if (!getInfo.ok) {
    throw new Error(`GET session failed after restart: ${getInfo.status}`);
  }

  // Chat after reopen (ensureOpen).
  const prior = hist2Body.messages!.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts ?? [],
  }));
  const sse2 = await chat(
    server2.url,
    sessionId,
    "Reply with exactly one word: pong",
    prior,
  );
  if (!reconstructText(sse2).trim() && !sse2.includes("finish")) {
    throw new Error(`chat after reopen looks empty: ${sse2.slice(0, 400)}`);
  }
  console.log("[m4] chat after reopen ok");

  // Delete forbids further chat / history.
  const del = await fetch(
    `${server2.url}/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!del.ok) throw new Error(`delete failed: ${del.status}`);

  const gone = await fetch(
    `${server2.url}/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  if (gone.status !== 404) {
    throw new Error(`expected 404 after delete, got ${gone.status}`);
  }

  const goneMsg = await fetch(
    `${server2.url}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  if (goneMsg.status !== 404) {
    throw new Error(`expected messages 404 after delete, got ${goneMsg.status}`);
  }

  const chatGone = await fetch(`${server2.url}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qenex-session-id": sessionId,
    },
    body: JSON.stringify({
      sessionId,
      messages: [
        { id: "x", role: "user", parts: [{ type: "text", text: "nope" }] },
      ],
    }),
  });
  if (chatGone.status !== 404) {
    throw new Error(`expected chat 404 after delete, got ${chatGone.status}`);
  }
  console.log("[m4] delete forbids chat ok");

  server2.stop({ wipe: true });
  console.log("M4_ACCEPTANCE_OK");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    rmSync(dbDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
