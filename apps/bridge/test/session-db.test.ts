import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import type { UIMessage } from "ai";
import { SessionDb } from "../src/session-db.ts";
import { deriveTitleFromMessages } from "../src/session-store.ts";

describe("SessionDb", () => {
  let db: SessionDb;
  let path: string;

  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), "qenex-session-db-")), "sessions.db");
    db = new SessionDb(path);
  });

  afterEach(() => {
    db.close();
  });

  test("upsert / list / get / delete session", () => {
    db.upsertSession({
      sessionId: "ses_a",
      agent: "opencode",
      cwd: "/tmp/a",
      title: null,
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    expect(db.listSessions()).toHaveLength(1);
    expect(db.getSession("ses_a")?.cwd).toBe("/tmp/a");
    expect(db.deleteSession("ses_a")).toBe(true);
    expect(db.getSession("ses_a")).toBeNull();
  });

  test("replaceMessages round-trip preserves parts + metadata", () => {
    db.upsertSession({
      sessionId: "ses_m",
      agent: "opencode",
      cwd: "/tmp/m",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "world", state: "done" }],
        metadata: { plan: [{ content: "step" }] },
      },
    ];
    db.replaceMessages("ses_m", messages);
    expect(db.countMessages("ses_m")).toBe(2);
    const loaded = db.getMessages("ses_m");
    expect(loaded[0]?.parts).toEqual([{ type: "text", text: "hello" }]);
    expect(loaded[1]?.parts).toEqual([
      { type: "text", text: "world", state: "done" },
    ]);
    expect(loaded[1]?.metadata).toEqual({ plan: [{ content: "step" }] });

    db.deleteSession("ses_m");
    expect(db.getMessages("ses_m")).toEqual([]);
  });

  test("setTitle updates row", () => {
    db.upsertSession({
      sessionId: "ses_t",
      agent: "opencode",
      cwd: "/tmp/t",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    expect(db.setTitle("ses_t", "你好世界")).toBe(true);
    expect(db.getSession("ses_t")?.title).toBe("你好世界");
  });

  test("replaceMessages dedupes duplicate message ids", () => {
    db.upsertSession({
      sessionId: "ses_dup",
      agent: "opencode",
      cwd: "/tmp/d",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    db.replaceMessages("ses_dup", [
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "old" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "new" }] },
    ]);
    const loaded = db.getMessages("ses_dup");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.parts).toEqual([{ type: "text", text: "new" }]);
  });

  test("survives reopen on same file", () => {
    db.upsertSession({
      sessionId: "ses_r",
      agent: "opencode",
      cwd: "/tmp/r",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    db.replaceMessages("ses_r", [
      { id: "u", role: "user", parts: [{ type: "text", text: "persist" }] },
    ]);
    db.close();
    const again = new SessionDb(path);
    expect(again.getSession("ses_r")?.cwd).toBe("/tmp/r");
    expect(again.getMessages("ses_r")[0]?.id).toBe("u");
    again.close();
    db = new SessionDb(path); // afterEach closes
  });

  test("replaceMessages upserts changes and skips identical rows", () => {
    db.upsertSession({
      sessionId: "ses_inc",
      agent: "opencode",
      cwd: "/tmp/i",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    const first: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "one" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "two" }] },
    ];
    db.replaceMessages("ses_inc", first);
    const raw = new Database(path);
    const createdBefore = raw
      .query(
        `SELECT message_id, created_at, parts_json FROM messages
         WHERE session_id = ? ORDER BY sort_index`,
      )
      .all("ses_inc") as Array<{
      message_id: string;
      created_at: string;
      parts_json: string;
    }>;
    expect(createdBefore).toHaveLength(2);

    db.replaceMessages("ses_inc", first);
    const createdSame = raw
      .query(
        `SELECT message_id, created_at FROM messages
         WHERE session_id = ? ORDER BY sort_index`,
      )
      .all("ses_inc") as Array<{ message_id: string; created_at: string }>;
    expect(createdSame.map((row) => row.created_at)).toEqual(
      createdBefore.map((row) => row.created_at),
    );

    db.replaceMessages("ses_inc", [
      first[0]!,
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "two!" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "three" }] },
    ]);
    const after = raw
      .query(
        `SELECT message_id, created_at, parts_json FROM messages
         WHERE session_id = ? ORDER BY sort_index`,
      )
      .all("ses_inc") as Array<{
      message_id: string;
      created_at: string;
      parts_json: string;
    }>;
    expect(after.map((row) => row.message_id)).toEqual(["u1", "a1", "u2"]);
    expect(after[0]?.created_at).toBe(createdBefore[0]?.created_at);
    expect(after[1]?.parts_json).toContain("two!");
    expect(after[2]?.message_id).toBe("u2");
    raw.close();
  });

  test("replaceMessages deletes ids missing from the new list", () => {
    db.upsertSession({
      sessionId: "ses_del",
      agent: "opencode",
      cwd: "/tmp/d2",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    db.replaceMessages("ses_del", [
      { id: "keep", role: "user", parts: [{ type: "text", text: "a" }] },
      { id: "drop", role: "assistant", parts: [{ type: "text", text: "b" }] },
    ]);
    db.replaceMessages("ses_del", [
      { id: "keep", role: "user", parts: [{ type: "text", text: "a" }] },
    ]);
    const loaded = db.getMessages("ses_del");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("keep");
  });

  test("getMessages paginates with limit and before", () => {
    db.upsertSession({
      sessionId: "ses_page",
      agent: "opencode",
      cwd: "/tmp/p",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    db.replaceMessages("ses_page", [
      { id: "m1", role: "user", parts: [{ type: "text", text: "1" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "2" }] },
      { id: "m3", role: "user", parts: [{ type: "text", text: "3" }] },
      { id: "m4", role: "assistant", parts: [{ type: "text", text: "4" }] },
    ]);
    expect(db.getMessages("ses_page").map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(db.getMessages("ses_page", { limit: 2 }).map((m) => m.id)).toEqual([
      "m3",
      "m4",
    ]);
    expect(
      db.getMessages("ses_page", { limit: 2, before: "m3" }).map((m) => m.id),
    ).toEqual(["m1", "m2"]);
    expect(
      db.getMessages("ses_page", { limit: 2, before: "missing" }),
    ).toEqual([]);
  });

  test("migrates legacy session_id into local + remote ids", () => {
    const legacyPath = join(
      mkdtempSync(join(tmpdir(), "qenex-session-legacy-")),
      "sessions.db",
    );
    const raw = new Database(legacyPath);
    raw.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY NOT NULL,
        agent TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        modes_json TEXT,
        models_json TEXT
      );
    `);
    raw
      .query(
        `INSERT INTO sessions (session_id, agent, cwd, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "ses_old",
        "opencode",
        "/tmp/old",
        null,
        "2026-08-03T00:00:00.000Z",
        "2026-08-03T00:00:00.000Z",
      );
    raw.close();

    const migrated = new SessionDb(legacyPath);
    const row = migrated.getSession("ses_old");
    expect(row?.sessionId).toBe("ses_old");
    expect(row?.remoteSessionId).toBe("ses_old");
    expect(row?.resumeBehavior).toBe("native-load");
    migrated.close();
  });

  test("updateRemoteSession keeps the local PK", () => {
    db.upsertSession({
      sessionId: "ses_local",
      remoteSessionId: "ses_local",
      resumeBehavior: "native-load",
      agent: "opencode",
      cwd: "/tmp/r",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    expect(db.updateRemoteSession("ses_local", "ses_remote_2", "reconnect-fresh")).toBe(
      true,
    );
    const row = db.getSession("ses_local");
    expect(row?.sessionId).toBe("ses_local");
    expect(row?.remoteSessionId).toBe("ses_remote_2");
    expect(row?.resumeBehavior).toBe("reconnect-fresh");
    db.upsertSession({
      sessionId: "ses_local",
      agent: "opencode",
      cwd: "/tmp/r",
      createdAt: "2026-08-03T00:00:00.000Z",
      modesJson: JSON.stringify({ currentModeId: "build" }),
    });
    const afterPersist = db.getSession("ses_local");
    expect(afterPersist?.remoteSessionId).toBe("ses_remote_2");
  });

  test("persists thoughtLevels and fastOptions through reopen", () => {
    const thought = {
      configId: "reasoning_effort",
      currentId: "high",
      available: [
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
      ],
    };
    const fast = {
      configId: "fast-mode",
      currentId: "off",
      available: [{ id: "off", name: "Off" }],
    };
    db.upsertSession({
      sessionId: "ses_thought",
      agent: "codex-acp",
      cwd: "/tmp/c",
      createdAt: "2026-08-14T00:00:00.000Z",
      modelsJson: JSON.stringify({
        currentModelId: "gpt-5.6-sol",
        availableModels: [{ modelId: "gpt-5.6-sol", name: "GPT-5.6-Sol" }],
      }),
      thoughtLevelsJson: JSON.stringify(thought),
      fastOptionsJson: JSON.stringify(fast),
    });
    const row = db.getSession("ses_thought");
    expect(JSON.parse(row?.thoughtLevelsJson ?? "null")).toEqual(thought);
    expect(JSON.parse(row?.fastOptionsJson ?? "null")).toEqual(fast);

    db.close();
    const again = new SessionDb(path);
    const reopened = again.getSession("ses_thought");
    expect(JSON.parse(reopened?.thoughtLevelsJson ?? "null")).toEqual(thought);
    expect(JSON.parse(reopened?.fastOptionsJson ?? "null")).toEqual(fast);
    again.close();
    db = new SessionDb(path);
  });

  test("persists config_axes_json through reopen", () => {
    const axes = {
      contextOptions: {
        configId: "context",
        currentId: "272k",
        available: [{ id: "272k", name: "272k" }],
      },
      modelConfigById: {
        "gpt-5.5": {
          thoughtLevels: {
            configId: "reasoning",
            currentId: "ultra",
            available: [{ id: "ultra", name: "Ultra" }],
          },
        },
      },
    };
    db.upsertSession({
      sessionId: "ses_axes",
      agent: "cursor-agent",
      cwd: "/tmp/x",
      createdAt: "2026-08-18T00:00:00.000Z",
      configAxesJson: JSON.stringify(axes),
    });
    expect(JSON.parse(db.getSession("ses_axes")?.configAxesJson ?? "null")).toEqual(
      axes,
    );
    db.close();
    const again = new SessionDb(path);
    expect(
      JSON.parse(again.getSession("ses_axes")?.configAxesJson ?? "null"),
    ).toEqual(axes);
    again.close();
    db = new SessionDb(path);
  });

  test("migrates legacy sessions without thought columns", () => {
    const legacyPath = join(
      mkdtempSync(join(tmpdir(), "qenex-session-thought-")),
      "sessions.db",
    );
    const raw = new Database(legacyPath);
    raw.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY NOT NULL,
        agent TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        modes_json TEXT,
        models_json TEXT,
        remote_session_id TEXT,
        resume_behavior TEXT
      );
    `);
    raw
      .query(
        `INSERT INTO sessions (
          session_id, agent, cwd, title, created_at, updated_at, models_json,
          remote_session_id, resume_behavior
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "ses_old_thought",
        "codex-acp",
        "/tmp/old",
        null,
        "2026-08-03T00:00:00.000Z",
        "2026-08-03T00:00:00.000Z",
        JSON.stringify({
          currentModelId: "gpt-5.6-sol",
          availableModels: [{ modelId: "gpt-5.6-sol", name: "GPT-5.6-Sol" }],
        }),
        "ses_old_thought",
        "native-load",
      );
    raw.close();

    const migrated = new SessionDb(legacyPath);
    const row = migrated.getSession("ses_old_thought");
    expect(row?.thoughtLevelsJson).toBeNull();
    expect(row?.fastOptionsJson).toBeNull();
    migrated.upsertSession({
      sessionId: "ses_old_thought",
      agent: "codex-acp",
      cwd: "/tmp/old",
      createdAt: "2026-08-03T00:00:00.000Z",
      thoughtLevelsJson: JSON.stringify({
        configId: "reasoning_effort",
        currentId: "high",
        available: [{ id: "high", name: "High" }],
      }),
    });
    expect(
      JSON.parse(migrated.getSession("ses_old_thought")?.thoughtLevelsJson ?? "null")
        ?.configId,
    ).toBe("reasoning_effort");
    migrated.close();
  });
});

describe("deriveTitleFromMessages", () => {
  test("uses first user text", () => {
    expect(
      deriveTitleFromMessages([
        { id: "u", role: "user", parts: [{ type: "text", text: "  hi there  " }] },
      ]),
    ).toBe("hi there");
  });

  test("truncates long titles", () => {
    const long = "x".repeat(80);
    const title = deriveTitleFromMessages([
      { id: "u", role: "user", parts: [{ type: "text", text: long }] },
    ]);
    expect(title?.endsWith("…")).toBe(true);
    expect(title!.length).toBe(51);
  });
});
