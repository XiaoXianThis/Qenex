/**
 * SQLite persistence for Bridge sessions + UIMessage history (M4).
 * Default path: ~/.qenex/sessions.db (override with QENEX_SESSIONS_DB).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { UIMessage } from "ai";

export type PersistedSessionRow = {
  sessionId: string;
  agent: string;
  cwd: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  modesJson: string | null;
  modelsJson: string | null;
};

export function resolveSessionsDbPath(
  override?: string | null,
): string {
  if (override && override.trim()) return override.trim();
  const fromEnv = process.env.QENEX_SESSIONS_DB?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), ".qenex", "sessions.db");
}

function ensureParentDir(dbPath: string): void {
  if (dbPath === ":memory:" || dbPath.startsWith("file:")) return;
  mkdirSync(dirname(dbPath), { recursive: true });
}

export class SessionDb {
  readonly path: string;
  readonly #db: Database;

  constructor(dbPath: string = resolveSessionsDbPath()) {
    this.path = dbPath;
    ensureParentDir(dbPath);
    this.#db = new Database(dbPath, { create: true });
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec("PRAGMA foreign_keys = ON;");
    this.#migrate();
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY NOT NULL,
        agent TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        modes_json TEXT,
        models_json TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        role TEXT NOT NULL,
        parts_json TEXT NOT NULL,
        metadata_json TEXT,
        sort_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, message_id),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_sort
        ON messages(session_id, sort_index);
    `);
  }

  close(): void {
    this.#db.close();
  }

  upsertSession(row: {
    sessionId: string;
    agent: string;
    cwd: string;
    title?: string | null;
    createdAt: string;
    updatedAt?: string;
    modesJson?: string | null;
    modelsJson?: string | null;
  }): void {
    const updatedAt = row.updatedAt ?? row.createdAt;
    this.#db
      .query(
        `INSERT INTO sessions (
          session_id, agent, cwd, title, created_at, updated_at, modes_json, models_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          agent = excluded.agent,
          cwd = excluded.cwd,
          title = COALESCE(excluded.title, sessions.title),
          updated_at = excluded.updated_at,
          modes_json = COALESCE(excluded.modes_json, sessions.modes_json),
          models_json = COALESCE(excluded.models_json, sessions.models_json)`,
      )
      .run(
        row.sessionId,
        row.agent,
        row.cwd,
        row.title ?? null,
        row.createdAt,
        updatedAt,
        row.modesJson ?? null,
        row.modelsJson ?? null,
      );
  }

  getSession(sessionId: string): PersistedSessionRow | null {
    const row = this.#db
      .query(
        `SELECT session_id, agent, cwd, title, created_at, updated_at, modes_json, models_json
         FROM sessions WHERE session_id = ?`,
      )
      .get(sessionId) as
      | {
          session_id: string;
          agent: string;
          cwd: string;
          title: string | null;
          created_at: string;
          updated_at: string;
          modes_json: string | null;
          models_json: string | null;
        }
      | null;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      agent: row.agent,
      cwd: row.cwd,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      modesJson: row.modes_json,
      modelsJson: row.models_json,
    };
  }

  listSessions(): PersistedSessionRow[] {
    const rows = this.#db
      .query(
        `SELECT session_id, agent, cwd, title, created_at, updated_at, modes_json, models_json
         FROM sessions
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      session_id: string;
      agent: string;
      cwd: string;
      title: string | null;
      created_at: string;
      updated_at: string;
      modes_json: string | null;
      models_json: string | null;
    }>;
    return rows.map((row) => ({
      sessionId: row.session_id,
      agent: row.agent,
      cwd: row.cwd,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      modesJson: row.modes_json,
      modelsJson: row.models_json,
    }));
  }

  deleteSession(sessionId: string): boolean {
    const result = this.#db
      .query(`DELETE FROM sessions WHERE session_id = ?`)
      .run(sessionId);
    return result.changes > 0;
  }

  deleteAllSessions(): void {
    this.#db.exec(`DELETE FROM messages; DELETE FROM sessions;`);
  }

  setTitle(sessionId: string, title: string): boolean {
    const now = new Date().toISOString();
    const result = this.#db
      .query(
        `UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?`,
      )
      .run(title, now, sessionId);
    return result.changes > 0;
  }

  touch(sessionId: string): void {
    this.#db
      .query(`UPDATE sessions SET updated_at = ? WHERE session_id = ?`)
      .run(new Date().toISOString(), sessionId);
  }

  replaceMessages(sessionId: string, messages: UIMessage[]): void {
    const now = new Date().toISOString();
    // AI SDK onEnd can include continued assistant rows that share an id with
    // an earlier entry — keep the last occurrence per message id.
    const deduped: UIMessage[] = [];
    const indexById = new Map<string, number>();
    for (const message of messages) {
      const id =
        typeof message.id === "string" && message.id.length > 0
          ? message.id
          : `msg_${deduped.length}`;
      const normalized = message.id === id ? message : { ...message, id };
      const existing = indexById.get(id);
      if (existing != null) {
        deduped[existing] = normalized;
      } else {
        indexById.set(id, deduped.length);
        deduped.push(normalized);
      }
    }

    const tx = this.#db.transaction(() => {
      this.#db
        .query(`DELETE FROM messages WHERE session_id = ?`)
        .run(sessionId);
      const insert = this.#db.query(
        `INSERT INTO messages (
          session_id, message_id, role, parts_json, metadata_json, sort_index, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      deduped.forEach((message, index) => {
        insert.run(
          sessionId,
          message.id,
          message.role,
          JSON.stringify(message.parts ?? []),
          message.metadata != null ? JSON.stringify(message.metadata) : null,
          index,
          now,
        );
      });
      this.#db
        .query(`UPDATE sessions SET updated_at = ? WHERE session_id = ?`)
        .run(now, sessionId);
    });
    tx();
  }

  getMessages(sessionId: string): UIMessage[] {
    const rows = this.#db
      .query(
        `SELECT message_id, role, parts_json, metadata_json
         FROM messages
         WHERE session_id = ?
         ORDER BY sort_index ASC`,
      )
      .all(sessionId) as Array<{
      message_id: string;
      role: string;
      parts_json: string;
      metadata_json: string | null;
    }>;

    return rows.map((row) => {
      let parts: UIMessage["parts"] = [];
      try {
        parts = JSON.parse(row.parts_json) as UIMessage["parts"];
      } catch {
        parts = [{ type: "text", text: "" }];
      }
      let metadata: UIMessage["metadata"];
      if (row.metadata_json) {
        try {
          metadata = JSON.parse(row.metadata_json) as UIMessage["metadata"];
        } catch {
          metadata = undefined;
        }
      }
      return {
        id: row.message_id,
        role: row.role as UIMessage["role"],
        parts,
        ...(metadata !== undefined ? { metadata } : {}),
      };
    });
  }

  countMessages(sessionId: string): number {
    const row = this.#db
      .query(`SELECT COUNT(*) AS n FROM messages WHERE session_id = ?`)
      .get(sessionId) as { n: number };
    return row?.n ?? 0;
  }
}
