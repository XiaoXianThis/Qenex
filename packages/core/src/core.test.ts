import { describe, expect, test } from "bun:test";
import {
  BridgeClientError,
  createSession,
  deleteSession,
  formatBridgeError,
  healthCheck,
  listSessions,
  loadApprovalMode,
  loadLastCwd,
  loadTheme,
  parseMessageMetadata,
  saveApprovalMode,
  saveLastCwd,
  saveTheme,
  type QenexHost,
} from "./index.ts";
import { startBridgeServer } from "../../../apps/bridge/src/server.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function memoryHost(baseUrl: string): QenexHost {
  const map = new Map<string, string>();
  return {
    kind: "web",
    getBridgeBaseUrl: () => baseUrl,
    fetch: globalThis.fetch.bind(globalThis),
    storage: {
      get: (k) => map.get(k) ?? null,
      set: (k, v) => void map.set(k, v),
      remove: (k) => void map.delete(k),
    },
  };
}

const fixture = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../apps/bridge/test/fixtures/workspace",
);

describe("@qenex/core prefs", () => {
  test("cwd and theme round-trip", () => {
    const host = memoryHost("http://127.0.0.1:9");
    expect(loadLastCwd(host)).toBe("");
    saveLastCwd(host, "/tmp/project");
    expect(loadLastCwd(host)).toBe("/tmp/project");
    expect(loadTheme(host)).toBe("system");
    saveTheme(host, "dark");
    expect(loadTheme(host)).toBe("dark");
    expect(loadApprovalMode(host)).toBe("ask");
    saveApprovalMode(host, "auto");
    expect(loadApprovalMode(host)).toBe("auto");
  });
});

describe("@qenex/core errors + metadata", () => {
  test("formatBridgeError maps known codes", () => {
    expect(
      formatBridgeError(
        new BridgeClientError("opencode_not_found", "missing", 503),
      ),
    ).toContain("安装 OpenCode");
    expect(
      formatBridgeError(
        new BridgeClientError("opencode_auth_required", "auth", 401),
      ),
    ).toContain("登录");
    expect(
      formatBridgeError(
        new BridgeClientError("opencode_spawn_failed", "spawn", 502),
      ),
    ).toContain("启动 OpenCode");
  });

  test("parseMessageMetadata is defensive", () => {
    expect(parseMessageMetadata(null)).toBeUndefined();
    expect(parseMessageMetadata({ plan: [{ nope: true }] })).toBeUndefined();
    const parsed = parseMessageMetadata({
      plan: [{ content: "step", status: "pending", priority: "high" }],
      diffs: [
        { path: "a.ts", newText: "x", oldText: null, toolCallId: "t1" },
        { path: 1, newText: "bad" },
      ],
      terminals: [{ terminalId: "term" }, { terminalId: 2 }],
    });
    expect(parsed?.plan).toHaveLength(1);
    expect(parsed?.diffs).toHaveLength(1);
    expect(parsed?.terminals).toHaveLength(1);
  });
});

describe("@qenex/core bridge client", () => {
  test(
    "health + create/list/delete sessions against live bridge",
    async () => {
      const server = startBridgeServer({ hostname: "127.0.0.1", port: 0 });
      const host = memoryHost(server.url);
      try {
        const health = await healthCheck(host);
        expect(health.ok).toBe(true);
        expect(health.opencode).toBeTruthy();

        const session = await createSession(host, fixture);
        expect(session.sessionId).toBeTruthy();
        expect(session.agent).toBe("opencode");

        const listed = await listSessions(host);
        expect(listed.some((s) => s.sessionId === session.sessionId)).toBe(true);

        await deleteSession(host, session.sessionId);
        const after = await listSessions(host);
        expect(after.some((s) => s.sessionId === session.sessionId)).toBe(false);
      } finally {
        server.stop();
      }
    },
    120_000,
  );

  test(
    "createSession preserves BridgeClientError.code",
    async () => {
      const prev = process.env.QENEX_OPENCODE_BIN;
      process.env.QENEX_OPENCODE_BIN = "/missing/opencode-core-test";
      const isolated = startBridgeServer({ hostname: "127.0.0.1", port: 0 });
      const host = memoryHost(isolated.url);
      try {
        await createSession(host, fixture);
        throw new Error("expected createSession to fail");
      } catch (err) {
        expect(err).toBeInstanceOf(BridgeClientError);
        expect((err as BridgeClientError).code).toBe("opencode_not_found");
        expect(formatBridgeError(err)).toContain("安装 OpenCode");
      } finally {
        isolated.stop();
        if (prev === undefined) delete process.env.QENEX_OPENCODE_BIN;
        else process.env.QENEX_OPENCODE_BIN = prev;
      }
    },
    30_000,
  );
});
