import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startBridgeServer, type BridgeServer } from "../src/server.ts";
import { SessionStore } from "../src/session-store.ts";
import { resolveOpenCodeBin, BridgeError } from "../src/errors.ts";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const FIXTURE_CWD = resolve(root, "test/fixtures/workspace");
const TEST_DB = join(
  mkdtempSync(join(tmpdir(), "qenex-bridge-test-")),
  "sessions.db",
);

let server: BridgeServer;

beforeAll(() => {
  expect(existsSync(FIXTURE_CWD)).toBe(true);
  server = startBridgeServer({
    hostname: "127.0.0.1",
    port: 0,
    dbPath: TEST_DB,
  });
});

afterEach(() => {
  server?.store.clear();
});

afterAll(() => {
  server?.stop({ wipe: true });
});

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Phase 1 · bind & health", () => {
  test("listens on 127.0.0.1 only (rejects 0.0.0.0)", () => {
    expect(server.hostname).toBe("127.0.0.1");
    expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);
    expect(() =>
      startBridgeServer({ hostname: "0.0.0.0", port: 0 }),
    ).toThrow(BridgeError);
  });

  test("GET /health", async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      listen: string;
      opencode: string | null;
    };
    expect(json.ok).toBe(true);
    expect(json.listen).toBe("127.0.0.1");
    expect(json.opencode).toBeTruthy();
  });
});

describe("Phase 1 · OpenCode detection", () => {
  test("resolveOpenCodeBin finds a binary on this machine", () => {
    expect(resolveOpenCodeBin()).toBeTruthy();
  });

  test("POST /api/sessions returns opencode_not_found when binary missing", async () => {
    const isolatedDb = join(
      mkdtempSync(join(tmpdir(), "qenex-bridge-missing-")),
      "sessions.db",
    );
    const isolated = new SessionStore({ dbPath: isolatedDb });
    const tmp = startBridgeServer({
      hostname: "127.0.0.1",
      port: 0,
      store: isolated,
    });
    const prev = process.env.QENEX_OPENCODE_BIN;
    process.env.QENEX_OPENCODE_BIN = "/definitely/missing/opencode-binary-xyz";
    try {
      const res = await fetch(`${tmp.url}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: FIXTURE_CWD }),
      });
      expect(res.status).toBe(503);
      const json = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(json.error.code).toBe("opencode_not_found");
      expect(json.error.message.toLowerCase()).toContain("opencode");
    } finally {
      if (prev === undefined) delete process.env.QENEX_OPENCODE_BIN;
      else process.env.QENEX_OPENCODE_BIN = prev;
      tmp.stop();
    }
  });
});

describe("Phase 1 · sessions API", () => {
  test("POST /api/sessions creates session", async () => {
    const res = await postJson("/api/sessions", { cwd: FIXTURE_CWD });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      sessionId: string;
      agent: string;
      cwd: string;
    };
    expect(json.agent).toBe("opencode");
    expect(json.sessionId.length).toBeGreaterThan(4);
    expect(json.cwd).toBe(FIXTURE_CWD);
  }, 120_000);

  test("POST /api/sessions rejects missing cwd", async () => {
    const res = await postJson("/api/sessions", {});
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("missing_cwd");
  });

  test("POST /api/sessions rejects invalid cwd", async () => {
    const res = await postJson("/api/sessions", {
      cwd: "/no/such/dir/qenex-phase1",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_cwd");
  });

  test("GET /api/sessions/:id and list", async () => {
    const created = (await (
      await postJson("/api/sessions", { cwd: FIXTURE_CWD })
    ).json()) as { sessionId: string };

    const one = await fetch(`${server.url}/api/sessions/${created.sessionId}`);
    expect(one.status).toBe(200);

    const list = await fetch(`${server.url}/api/sessions`);
    const body = (await list.json()) as { sessions: Array<{ sessionId: string }> };
    expect(body.sessions.some((s) => s.sessionId === created.sessionId)).toBe(
      true,
    );
  }, 120_000);

  test("unknown sessionId → 404", async () => {
    const res = await fetch(`${server.url}/api/sessions/ses_does_not_exist`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("session_not_found");
  });
});

describe("Phase 1 · chat streaming", () => {
  test("POST /api/chat returns UIMessage stream with text", async () => {
    const created = (await (
      await postJson("/api/sessions", { cwd: FIXTURE_CWD })
    ).json()) as { sessionId: string };

    const res = await postJson("/api/chat", {
      sessionId: created.sessionId,
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [
            {
              type: "text",
              text: "Reply with exactly one short English sentence that includes the word BRIDGE. No tools.",
            },
          ],
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-qenex-session-id")).toBe(created.sessionId);
    const ctype = res.headers.get("content-type") ?? "";
    expect(
      ctype.includes("text/event-stream") ||
        ctype.includes("text/plain") ||
        ctype.includes("application/octet-stream") ||
        ctype.length > 0,
    ).toBe(true);

    const raw = await res.text();
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.includes("text-delta") || raw.includes("data:")).toBe(true);

    // Reconstruct assistant text from UIMessage SSE deltas (tokens may be split).
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
        /* ignore non-JSON data lines */
      }
    }
    const text = deltas.join("");
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toContain("bridge");
  }, 180_000);

  test("POST /api/chat with bad sessionId → 404", async () => {
    const res = await postJson("/api/chat", {
      sessionId: "ses_missing_xyz",
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("session_not_found");
  });

  test("POST /api/chat without sessionId → 400", async () => {
    const res = await postJson("/api/chat", {
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
    });
    expect(res.status).toBe(400);
  });

  test("DELETE session then chat fails", async () => {
    const created = (await (
      await postJson("/api/sessions", { cwd: FIXTURE_CWD })
    ).json()) as { sessionId: string };

    const del = await fetch(
      `${server.url}/api/sessions/${created.sessionId}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(200);

    const chat = await postJson("/api/chat", {
      sessionId: created.sessionId,
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "should fail" }],
        },
      ],
    });
    expect(chat.status).toBe(404);
    const json = (await chat.json()) as { error: { code: string } };
    expect(json.error.code).toBe("session_not_found");
  }, 120_000);
});
