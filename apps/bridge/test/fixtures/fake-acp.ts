#!/usr/bin/env bun
/**
 * Minimal ACP agent over NDJSON JSON-RPC (same framing as @agentclientprotocol/sdk).
 * Used by hermetic Bridge tests so CI does not need OpenCode.
 *
 * Methods: initialize, session/new, session/load, session/prompt,
 * session/cancel, session/set_mode, session/set_model, session/set_config_option.
 */
const sessions = new Map<
  string,
  { cwd: string; modeId: string; modelId: string }
>();
let nextId = 1;

function write(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function result(id: unknown, value: unknown): void {
  write({ jsonrpc: "2.0", id, result: value });
}

function error(id: unknown, code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method: string, params: unknown): void {
  write({ jsonrpc: "2.0", method, params });
}

function handle(msg: {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}): void {
  const id = msg.id;
  const method = msg.method ?? "";
  const params = msg.params ?? {};

  switch (method) {
    case "initialize": {
      const protocolVersion = params.protocolVersion ?? 1;
      result(id, {
        protocolVersion,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: false,
            audio: false,
            embeddedContext: true,
          },
        },
        agentInfo: { name: "fake-acp", version: "0.0.1" },
        authMethods: [],
      });
      return;
    }
    case "session/new": {
      const sessionId = `ses_fake_${nextId++}`;
      const cwd = typeof params.cwd === "string" ? params.cwd : ".";
      sessions.set(sessionId, {
        cwd,
        modeId: "ask",
        modelId: "fake",
      });
      result(id, {
        sessionId,
        modes: {
          currentModeId: "ask",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code" },
          ],
        },
        models: {
          currentModelId: "fake",
          availableModels: [{ modelId: "fake", name: "Fake" }],
        },
      });
      return;
    }
    case "session/load": {
      const sessionId =
        typeof params.sessionId === "string" ? params.sessionId : "";
      const existing = sessions.get(sessionId);
      if (!existing) {
        sessions.set(sessionId, {
          cwd: typeof params.cwd === "string" ? params.cwd : ".",
          modeId: "ask",
          modelId: "fake",
        });
      }
      result(id, {
        sessionId,
        modes: {
          currentModeId: sessions.get(sessionId)?.modeId ?? "ask",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code" },
          ],
        },
        models: {
          currentModelId: sessions.get(sessionId)?.modelId ?? "fake",
          availableModels: [{ modelId: "fake", name: "Fake" }],
        },
      });
      return;
    }
    case "session/prompt": {
      const sessionId =
        typeof params.sessionId === "string" ? params.sessionId : "";
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "FAKE_ACP_PONG includes BRIDGE." },
        },
      });
      result(id, { stopReason: "end_turn" });
      return;
    }
    case "session/cancel":
      result(id, {});
      return;
    case "session/set_mode": {
      const sessionId =
        typeof params.sessionId === "string" ? params.sessionId : "";
      const modeId =
        typeof params.modeId === "string" ? params.modeId : "ask";
      const session = sessions.get(sessionId);
      if (session) session.modeId = modeId;
      result(id, {});
      return;
    }
    case "session/set_model": {
      const sessionId =
        typeof params.sessionId === "string" ? params.sessionId : "";
      const modelId =
        typeof params.modelId === "string" ? params.modelId : "fake";
      const session = sessions.get(sessionId);
      if (session) session.modelId = modelId;
      result(id, {});
      return;
    }
    case "session/set_config_option":
      result(id, {});
      return;
    case "authenticate":
      result(id, {});
      return;
    case "shutdown":
      result(id, {});
      process.exit(0);
      return;
    default:
      if (id !== undefined) {
        error(id, -32601, `Method not found: ${method}`);
      }
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let idx = buf.indexOf("\n");
  while (idx >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) {
      try {
        handle(JSON.parse(line) as {
          id?: unknown;
          method?: string;
          params?: Record<string, unknown>;
        });
      } catch (err) {
        process.stderr.write(`[fake-acp] ${err}\n`);
      }
    }
    idx = buf.indexOf("\n");
  }
});
