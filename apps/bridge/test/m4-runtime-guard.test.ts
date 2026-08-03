/**
 * M4 guards: SQLite sessions.db, messages API, no AG-UI / tasks.db resume.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("M4 · Bridge persistence", () => {
  test("session-db module and messages/title routes exist", () => {
    expect(existsSync(resolve(repoRoot, "apps/bridge/src/session-db.ts"))).toBe(
      true,
    );
    const server = read("apps/bridge/src/server.ts");
    expect(server).toContain("/messages");
    expect(server).toContain('req.method === "PATCH"');
    expect(server).toContain("updateTitle");
    expect(server).toContain("getMessages");
    expect(server).toContain("persistedSessions");

    const store = read("apps/bridge/src/session-store.ts");
    expect(store).toContain("ensureOpen");
    expect(store).toContain("existingSessionId");
    expect(store).toContain("saveMessages");
    expect(store).toContain("dispose");

    const chat = read("apps/bridge/src/chat.ts");
    expect(chat).toContain("originalMessages");
    expect(chat).toContain("onEnd");
    expect(chat).toContain("saveMessages");
  });

  test("default db path is ~/.qenex/sessions.db", () => {
    const db = read("apps/bridge/src/session-db.ts");
    expect(db).toContain('.qenex"');
    expect(db).toContain("sessions.db");
    expect(db).toContain("QENEX_SESSIONS_DB");
  });
});

describe("M4 · no legacy AG-UI / tasks.db", () => {
  test("runtime does not read tasks.db or AG-UI replay", () => {
    const provider = read("packages/ui/src/components/AgentRuntimeProvider.tsx");
    expect(provider).not.toContain("useAgUiRuntime");
    expect(provider).not.toContain("replay-agui");
    expect(provider).not.toContain("tasks.db");
    expect(provider).toContain("listAisdkSessionMessages");
    expect(provider).toContain("initialMessages");

    const aisdk = read("packages/core/src/lib/aisdk-session.ts");
    expect(aisdk).toContain("/messages");
    expect(aisdk).not.toContain("/v2/tasks");

    // Guard files must not reintroduce AG-UI history adapters.
    expect(
      existsSync(
        resolve(repoRoot, "packages/core/src/lib/replay-agui-events.ts"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        resolve(repoRoot, "packages/core/src/lib/bridge-history-adapter.ts"),
      ),
    ).toBe(false);
  });

  test("tabs store uses sessionId (not fusion taskId field)", () => {
    const tabs = read("packages/core/src/store/tabs-store.ts");
    expect(tabs).toContain("sessionId: string");
    expect(tabs).toContain("bindBridgeSession");
    // Migration may mention taskId once; field must not be the canonical key.
    expect(tabs).not.toMatch(/taskId:\s*string/);
    expect(tabs).not.toContain("needsHistoryLoad: false,\n            taskId:");
  });
});
