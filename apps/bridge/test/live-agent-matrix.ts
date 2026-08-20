/**
 * Live agent matrix (docs/agent-compat.md §11).
 *
 * Default CI does not run this. Gate with:
 *   QENEX_LIVE_AGENTS=opencode,claude-acp,codex-acp bun run test:live-matrix
 *
 * Passing this script is the only way to promote an agent to verified.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridgeServer } from "../src/server.ts";

const workspace = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/workspace",
);

type ErrorBody = {
  error?: { code?: string; message?: string };
};

type CreatedSession = {
  sessionId?: string;
  modes?: Array<{ id: string }>;
  models?: Array<{ id: string }>;
  currentModelId?: string | null;
  error?: { code?: string; message?: string };
};

type ConfigBody = {
  sessionId?: string;
  currentModelId?: string | null;
  models?: Array<{ id: string }>;
  error?: { code?: string; message?: string };
};

type ApprovalList = {
  approvals?: Array<{
    approvalId: string;
    options: Array<{ optionId: string }>;
  }>;
};

const requested = (process.env.QENEX_LIVE_AGENTS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (requested.length === 0) {
  console.log(
    "[live-matrix] skip: set QENEX_LIVE_AGENTS (comma-separated canonical ids)",
  );
  process.exit(0);
}

function fail(agentId: string, step: string, detail: string): never {
  const err = new Error(`[live-matrix] FAIL ${agentId} · ${step}\n${detail}`);
  throw err;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: { message: text } } as T;
  }
}

function extractChatText(raw: string): string {
  const deltas: string[] = [];
  for (const line of raw.split("\n")) {
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

async function chatOnce(
  url: string,
  sessionId: string,
  text: string,
  opts?: { abortAfterDelta?: boolean; timeoutMs?: number; signal?: AbortSignal },
): Promise<{ status: number; body: string; aborted: boolean }> {
  const ac = new AbortController();
  const onOuterAbort = () => ac.abort();
  opts?.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(
    () => ac.abort(),
    opts?.timeoutMs ?? 90_000,
  );
  let aborted = false;
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        sessionId,
        messages: [
          {
            id: `u_${crypto.randomUUID()}`,
            role: "user",
            parts: [{ type: "text", text }],
          },
        ],
      }),
    });
    if (!opts?.abortAfterDelta || !res.body) {
      const body = await res.text();
      return { status: res.status, body, aborted: false };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
      if (body.includes("text-delta")) {
        aborted = true;
        ac.abort();
        break;
      }
    }
    return { status: res.status, body, aborted };
  } catch (err) {
    if (aborted || (err instanceof Error && err.name === "AbortError")) {
      return { status: 499, body: "", aborted: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onOuterAbort);
  }
}

async function tryApprovalsDuringChat(
  url: string,
  sessionId: string,
): Promise<"responded" | "skipped"> {
  const gate = new AbortController();
  const chat = chatOnce(
    url,
    sessionId,
    "If you need a tool, request permission. Otherwise reply with PONG. No destructive actions.",
    { timeoutMs: 60_000, signal: gate.signal },
  );
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${url}/api/sessions/${sessionId}/approvals`);
    if (res.ok) {
      const body = await readJson<ApprovalList>(res);
      const pending = body.approvals?.[0];
      const optionId = pending?.options[0]?.optionId;
      if (pending && optionId) {
        const respond = await fetch(
          `${url}/api/sessions/${sessionId}/approvals/${pending.approvalId}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ optionId }),
          },
        );
        if (!respond.ok) {
          const err = await readJson<ErrorBody>(respond);
          fail(
            sessionId,
            "approval-respond",
            JSON.stringify(err).slice(0, 800),
          );
        }
        await chat;
        return "responded";
      }
    }
    await Bun.sleep(250);
  }
  gate.abort();
  await chat.catch(() => undefined);
  return "skipped";
}

const dbPath = join(mkdtempSync(join(tmpdir(), "qenex-live-matrix-")), "sessions.db");
const server = startBridgeServer({
  hostname: "127.0.0.1",
  port: 0,
  dbPath,
});
console.log("[live-matrix] server", server.url);
console.log("[live-matrix] agents", requested.join(", "));

try {
  for (const agentId of requested) {
    console.log(`\n[live-matrix] === ${agentId} ===`);

    const missing = await fetch(`${server.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cwd: workspace,
        agentId: `${agentId}-missing-bin-${Date.now()}`,
      }),
    });
    if (missing.status < 400) {
      fail(agentId, "missing-agent", `expected error, got ${missing.status}`);
    }
    const missingBody = await readJson<ErrorBody>(missing);
    console.log(
      "[live-matrix] missing agent",
      missing.status,
      missingBody.error?.code ?? missingBody.error?.message,
    );

    const create = await fetch(`${server.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: workspace, agentId }),
    });
    const created = await readJson<CreatedSession>(create);
    if (!create.ok || !created.sessionId) {
      fail(
        agentId,
        "create-session",
        `HTTP ${create.status} ${JSON.stringify(created).slice(0, 1200)}`,
      );
    }
    const sessionId = created.sessionId;
    console.log("[live-matrix] session", sessionId);

    const config = await fetch(`${server.url}/api/sessions/${sessionId}/config`);
    const configBody = await readJson<ConfigBody>(config);
    if (!config.ok) {
      fail(
        agentId,
        "get-config",
        `HTTP ${config.status} ${JSON.stringify(configBody).slice(0, 800)}`,
      );
    }
    const modelId = configBody.currentModelId ?? configBody.models?.[0]?.id;
    if (modelId) {
      const modelConfig = await fetch(
        `${server.url}/api/sessions/${sessionId}/models/${encodeURIComponent(modelId)}/config`,
      );
      if (!modelConfig.ok) {
        const err = await readJson<ErrorBody>(modelConfig);
        fail(
          agentId,
          "get-model-config",
          `HTTP ${modelConfig.status} ${JSON.stringify(err).slice(0, 800)}`,
        );
      }
      console.log("[live-matrix] model config ok", modelId);
    } else {
      console.log("[live-matrix] skip model-config (no model id)");
    }

    const streamed = await chatOnce(
      server.url,
      sessionId,
      "Reply with one short sentence containing PONG. No tools.",
    );
    if (streamed.status !== 200) {
      fail(
        agentId,
        "chat",
        `HTTP ${streamed.status} ${streamed.body.slice(0, 1200)}`,
      );
    }
    const text = extractChatText(streamed.body);
    if (!text.trim()) {
      fail(agentId, "chat", `no text-delta in stream: ${streamed.body.slice(0, 800)}`);
    }
    console.log("[live-matrix] chat text", text.slice(0, 120));

    const stopped = await chatOnce(
      server.url,
      sessionId,
      "Keep talking until I stop you.",
      { abortAfterDelta: true, timeoutMs: 30_000 },
    );
    console.log(
      "[live-matrix] stop",
      stopped.aborted ? "aborted after first delta" : `status=${stopped.status}`,
    );

    const approval = await tryApprovalsDuringChat(server.url, sessionId);
    console.log("[live-matrix] ask-approval", approval);

    const liveBefore = server.store.size;
    const hibernate = await fetch(
      `${server.url}/api/sessions/${sessionId}/hibernate`,
      { method: "POST" },
    );
    if (!hibernate.ok) {
      const err = await readJson<ErrorBody>(hibernate);
      fail(agentId, "hibernate", JSON.stringify(err).slice(0, 800));
    }
    if (server.store.size !== liveBefore - 1) {
      fail(
        agentId,
        "hibernate",
        `expected live size ${liveBefore - 1}, got ${server.store.size}`,
      );
    }

    const resumed = await fetch(`${server.url}/api/sessions/${sessionId}/config`);
    const resumedBody = await readJson<ConfigBody>(resumed);
    if (!resumed.ok) {
      fail(
        agentId,
        "resume-config",
        `HTTP ${resumed.status} ${JSON.stringify(resumedBody).slice(0, 800)}`,
      );
    }
    const afterResume = await chatOnce(
      server.url,
      sessionId,
      "Reply with one short sentence containing PONG. No tools.",
    );
    if (afterResume.status !== 200 || !extractChatText(afterResume.body).trim()) {
      fail(
        agentId,
        "resume-chat",
        `HTTP ${afterResume.status} ${afterResume.body.slice(0, 1200)}`,
      );
    }
    console.log("[live-matrix] resume ok");
    await fetch(`${server.url}/api/sessions/${sessionId}`, { method: "DELETE" });
    console.log(`[live-matrix] PASS ${agentId}`);
  }
} finally {
  server.stop({ wipe: true });
}

console.log("\n[live-matrix] all requested agents passed");
