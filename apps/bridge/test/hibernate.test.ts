import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeError } from "../src/errors.ts";
import { createBridgeHandler, startBridgeServer } from "../src/server.ts";
import { SessionDb } from "../src/session-db.ts";
import { SessionStore } from "../src/session-store.ts";

const fixtureCwd = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/workspace",
);

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "qenex-hibernate-")), "sessions.db");
}

describe("SessionStore.hibernate", () => {
  test("404 when session is missing from memory and SQLite", () => {
    const store = new SessionStore({ dbPath: tempDbPath() });
    try {
      expect(() => store.hibernate("ses_missing")).toThrow(BridgeError);
      try {
        store.hibernate("ses_missing");
      } catch (err) {
        expect(err).toMatchObject({ code: "session_not_found", status: 404 });
      }
    } finally {
      store.closeDb();
    }
  });

  test("no-op when already cold; getInfo and getMessages still work", () => {
    const db = new SessionDb(tempDbPath());
    db.upsertSession({
      sessionId: "ses_cold",
      agent: "opencode",
      cwd: fixtureCwd,
      createdAt: "2026-08-18T00:00:00.000Z",
      title: "Cold",
    });
    db.replaceMessages("ses_cold", [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]);
    const store = new SessionStore({ db });
    expect(store.size).toBe(0);
    const info = store.hibernate("ses_cold");
    expect(info.sessionId).toBe("ses_cold");
    expect(info.title).toBe("Cold");
    expect(store.getInfo("ses_cold").title).toBe("Cold");
    expect(store.getMessages("ses_cold")).toHaveLength(1);
    expect(store.size).toBe(0);
    store.closeDb();
  });
});

describe("POST /api/sessions/:id/hibernate", () => {
  test("returns session info and keeps history", async () => {
    const db = new SessionDb(tempDbPath());
    db.upsertSession({
      sessionId: "ses_http",
      agent: "opencode",
      cwd: fixtureCwd,
      createdAt: "2026-08-18T00:00:00.000Z",
    });
    db.replaceMessages("ses_http", [
      { id: "m1", role: "user", parts: [{ type: "text", text: "one" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "two" }] },
      { id: "m3", role: "user", parts: [{ type: "text", text: "three" }] },
    ]);
    const store = new SessionStore({ db });
    const fetchHandler = createBridgeHandler(store);

    const hibernate = await fetchHandler(
      new Request("http://127.0.0.1/api/sessions/ses_http/hibernate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(hibernate.status).toBe(200);
    const body = (await hibernate.json()) as { sessionId: string };
    expect(body.sessionId).toBe("ses_http");

    const info = await fetchHandler(
      new Request("http://127.0.0.1/api/sessions/ses_http"),
    );
    expect(info.status).toBe(200);

    const all = await fetchHandler(
      new Request("http://127.0.0.1/api/sessions/ses_http/messages"),
    );
    const allBody = (await all.json()) as { messages: Array<{ id: string }> };
    expect(allBody.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);

    const page = await fetchHandler(
      new Request("http://127.0.0.1/api/sessions/ses_http/messages?limit=2"),
    );
    const pageBody = (await page.json()) as { messages: Array<{ id: string }> };
    expect(pageBody.messages.map((m) => m.id)).toEqual(["m2", "m3"]);

    const before = await fetchHandler(
      new Request(
        "http://127.0.0.1/api/sessions/ses_http/messages?limit=2&before=m3",
      ),
    );
    const beforeBody = (await before.json()) as {
      messages: Array<{ id: string }>;
    };
    expect(beforeBody.messages.map((m) => m.id)).toEqual(["m1", "m2"]);

    const missing = await fetchHandler(
      new Request("http://127.0.0.1/api/sessions/ses_nope/hibernate", {
        method: "POST",
      }),
    );
    expect(missing.status).toBe(404);
    store.closeDb();
  });

  test("hibernate then ensureOpen reopens a live session", async () => {
    const server = startBridgeServer({
      hostname: "127.0.0.1",
      port: 0,
      dbPath: tempDbPath(),
    });
    try {
      const created = await fetch(`${server.url}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: fixtureCwd }),
      });
      expect(created.status).toBe(201);
      const info = (await created.json()) as { sessionId: string };
      expect(server.store.size).toBe(1);

      const hibernate = await fetch(
        `${server.url}/api/sessions/${info.sessionId}/hibernate`,
        { method: "POST" },
      );
      expect(hibernate.status).toBe(200);
      expect(server.store.size).toBe(0);
      expect(server.store.getInfo(info.sessionId).sessionId).toBe(info.sessionId);
      expect(server.store.getMessages(info.sessionId)).toEqual([]);

      const entry = await server.store.ensureOpen(info.sessionId);
      expect(entry.info.sessionId).toBe(info.sessionId);
      expect(server.store.size).toBe(1);
    } finally {
      server.stop({ wipe: true });
    }
  }, 120_000);
});
