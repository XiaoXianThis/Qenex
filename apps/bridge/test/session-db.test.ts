import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
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
