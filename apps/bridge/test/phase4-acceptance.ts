/**
 * Live Phase 4 acceptance:
 * - multi-session create / list / switch isolation / delete
 * - readable Bridge error codes for missing OpenCode
 * - chat SSE may emit message-metadata (plan/diff/terminal); never crashes parsing
 * - Auto edit path exercises stream + optional diff metadata
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridgeServer } from "../src/server.ts";
import { MessageMetadataAccumulator } from "../src/message-metadata.ts";

const workspaceA = mkdtempSync(join(tmpdir(), "qenex-phase4-a-"));
const workspaceB = mkdtempSync(join(tmpdir(), "qenex-phase4-b-"));
const server = startBridgeServer({ hostname: "127.0.0.1", port: 0 });

type SessionBody = {
  sessionId?: string;
  cwd?: string;
  error?: { code?: string; message?: string };
};

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

function collectMessageMetadata(sse: string) {
  const acc = new MessageMetadataAccumulator();
  let sawMessageMetadata = false;
  for (const line of sse.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload) as {
        type?: string;
        messageMetadata?: unknown;
        rawValue?: unknown;
      };
      if (evt.type === "message-metadata" && evt.messageMetadata) {
        sawMessageMetadata = true;
        const meta = evt.messageMetadata as {
          plan?: unknown;
          diffs?: unknown[];
          terminals?: unknown[];
        };
        if (meta.plan) {
          acc.ingest({
            type: "raw",
            rawValue: JSON.stringify({ type: "plan", entries: meta.plan }),
          });
        }
        if (Array.isArray(meta.diffs)) {
          for (const diff of meta.diffs) {
            acc.ingest({ type: "raw", rawValue: JSON.stringify(diff) });
          }
        }
        if (Array.isArray(meta.terminals)) {
          for (const terminal of meta.terminals) {
            acc.ingest({ type: "raw", rawValue: JSON.stringify(terminal) });
          }
        }
      }
      if (evt.type === "raw" && evt.rawValue != null) {
        acc.ingest({ type: "raw", rawValue: evt.rawValue });
      }
    } catch {
      /* ignore malformed SSE lines — UI must also tolerate them */
    }
  }
  return { sawMessageMetadata, snapshot: acc.snapshot() };
}

async function createSession(cwd: string): Promise<string> {
  const response = await fetch(`${server.url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const body = (await response.json()) as SessionBody;
  if (response.status !== 201 || !body.sessionId) {
    throw new Error(`session creation failed: ${JSON.stringify(body)}`);
  }
  return body.sessionId;
}

async function listSessions(): Promise<Array<{ sessionId: string; cwd: string }>> {
  const response = await fetch(`${server.url}/api/sessions`);
  if (!response.ok) throw new Error(`list failed (${response.status})`);
  const body = (await response.json()) as {
    sessions: Array<{ sessionId: string; cwd: string }>;
  };
  return body.sessions;
}

async function chat(
  sessionId: string,
  text: string,
  approvalMode: "ask" | "auto" = "auto",
): Promise<string> {
  const response = await fetch(`${server.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      approvalMode,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`chat failed (${response.status}): ${await response.text()}`);
  }
  return response.text();
}

try {
  console.log("[phase4] bridge", server.url);

  // --- multi session ---
  const sessionA = await createSession(workspaceA);
  const sessionB = await createSession(workspaceB);
  const listed = await listSessions();
  if (listed.length < 2) {
    throw new Error(`expected >=2 sessions, got ${listed.length}`);
  }
  if (!listed.some((s) => s.sessionId === sessionA && s.cwd === workspaceA)) {
    throw new Error("session A missing from list");
  }
  if (!listed.some((s) => s.sessionId === sessionB && s.cwd === workspaceB)) {
    throw new Error("session B missing from list");
  }
  console.log("[phase4] multi-session list ok");

  const markerA = `PHASE4A_${crypto.randomUUID().slice(0, 8)}`;
  const markerB = `PHASE4B_${crypto.randomUUID().slice(0, 8)}`;
  const sseA = await chat(
    sessionA,
    `Reply with exactly one short sentence containing the token ${markerA}. No tools.`,
  );
  const sseB = await chat(
    sessionB,
    `Reply with exactly one short sentence containing the token ${markerB}. No tools.`,
  );
  const textA = reconstructText(sseA);
  const textB = reconstructText(sseB);
  console.log("[phase4] chat A", textA.slice(0, 160));
  console.log("[phase4] chat B", textB.slice(0, 160));
  if (!textA.includes(markerA)) {
    throw new Error(`session A chat missing marker ${markerA}: ${textA}`);
  }
  if (!textB.includes(markerB)) {
    throw new Error(`session B chat missing marker ${markerB}: ${textB}`);
  }
  if (textA.includes(markerB) || textB.includes(markerA)) {
    throw new Error("sessions appear to cross-talk in streamed text");
  }
  console.log("[phase4] multi-session chat isolation ok");

  // --- optional plan/diff via Auto file edit ---
  const target = join(workspaceA, "phase4-note.txt");
  writeFileSync(target, "before\n", "utf8");
  const editSse = await chat(
    sessionA,
    `Overwrite the file phase4-note.txt in the workspace with exactly this content and nothing else:\nPHASE4_DIFF_OK\nUse tools. Do not ask questions.`,
    "auto",
  );
  const { sawMessageMetadata, snapshot } = collectMessageMetadata(editSse);
  console.log(
    "[phase4] edit metadata",
    JSON.stringify({
      sawMessageMetadata,
      plan: snapshot.plan?.length ?? 0,
      diffs: snapshot.diffs?.length ?? 0,
      terminals: snapshot.terminals?.length ?? 0,
      file: existsSync(target) ? readFileSync(target, "utf8").trim() : null,
    }),
  );
  // Parsing must never throw (already handled). Prefer seeing artifacts when Agent emits them.
  if (snapshot.diffs?.length) {
    const hit = snapshot.diffs.some(
      (d) =>
        d.path.includes("phase4-note.txt") ||
        d.newText.includes("PHASE4_DIFF_OK"),
    );
    if (!hit) {
      console.warn("[phase4] diffs present but path/content unexpected; tolerated");
    } else {
      console.log("[phase4] diff metadata ok");
    }
  } else {
    console.warn(
      "[phase4] no diff metadata in this run (OpenCode may omit raw diffs); UI must still tolerate empty metadata",
    );
  }

  // Delete B; A remains
  const del = await fetch(`${server.url}/api/sessions/${sessionB}`, {
    method: "DELETE",
  });
  if (!del.ok) throw new Error(`delete B failed (${del.status})`);
  const after = await listSessions();
  if (after.some((s) => s.sessionId === sessionB)) {
    throw new Error("session B still listed after delete");
  }
  if (!after.some((s) => s.sessionId === sessionA)) {
    throw new Error("session A missing after deleting B");
  }
  console.log("[phase4] delete isolation ok");

  // --- missing OpenCode error code ---
  const prev = process.env.QENEX_OPENCODE_BIN;
  process.env.QENEX_OPENCODE_BIN = "/definitely/missing/opencode-phase4";
  try {
    const isolated = startBridgeServer({ hostname: "127.0.0.1", port: 0 });
    try {
      const res = await fetch(`${isolated.url}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: workspaceA }),
      });
      const body = (await res.json()) as SessionBody;
      if (res.status !== 503 || body.error?.code !== "opencode_not_found") {
        throw new Error(`expected opencode_not_found, got ${JSON.stringify(body)}`);
      }
      console.log("[phase4] opencode_not_found error code ok");
    } finally {
      isolated.stop();
    }
  } finally {
    if (prev === undefined) delete process.env.QENEX_OPENCODE_BIN;
    else process.env.QENEX_OPENCODE_BIN = prev;
  }

  await fetch(`${server.url}/api/sessions/${sessionA}`, { method: "DELETE" });

  console.log("PHASE4_ACCEPTANCE_OK");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  server.stop();
  rmSync(workspaceA, { recursive: true, force: true });
  rmSync(workspaceB, { recursive: true, force: true });
}
