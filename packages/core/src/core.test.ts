import { describe, expect, test } from "bun:test";
import {
  createSession,
  deleteSession,
  healthCheck,
  loadLastCwd,
  saveLastCwd,
  loadTheme,
  saveTheme,
  loadApprovalMode,
  saveApprovalMode,
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

describe("@qenex/core bridge client", () => {
  test(
    "health + createSession + deleteSession against live bridge",
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

        await deleteSession(host, session.sessionId);
      } finally {
        server.stop();
      }
    },
    120_000,
  );
});
