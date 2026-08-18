/**
 * SQLite persistence for Bridge sessions + UIMessage history (M4).
 * Default path: ~/.qenex/sessions.db (override with QENEX_SESSIONS_DB).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { UIMessage } from "ai";
import type { ResumeBehavior } from "./agent/compat/types.ts";

export type PersistedSessionRow = {
  /** UI / URL / DB primary key. Stable across ACP reconnects. */
  sessionId: string;
  /** ACP session id. May rotate when load fails and we spawn fresh. */
  remoteSessionId: string;
  resumeBehavior: ResumeBehavior;
  agent: string;
  cwd: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  modesJson: string | null;
  modelsJson: string | null;
  thoughtLevelsJson: string | null;
  fastOptionsJson: string | null;
  configAxesJson: string | null;
};

type SessionQueryRow = {
  session_id: string;
  agent: string;
  cwd: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  modes_json: string | null;
  models_json: string | null;
  thought_levels_json: string | null;
  fast_options_json: string | null;
  config_axes_json: string | null;
  remote_session_id: string | null;
  resume_behavior: string | null;
};

function parseResumeBehavior(raw: string | null | undefined): ResumeBehavior {
  if (raw === "reconnect-fresh" || raw === "none" || raw === "native-load") {
    return raw;
  }
  return "native-load";
}

function mapSessionRow(row: SessionQueryRow): PersistedSessionRow {
  return {
    sessionId: row.session_id,
    remoteSessionId: row.remote_session_id || row.session_id,
    resumeBehavior: parseResumeBehavior(row.resume_behavior),
    agent: row.agent,
    cwd: row.cwd,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    modesJson: row.modes_json ?? null,
    modelsJson: row.models_json ?? null,
    thoughtLevelsJson: row.thought_levels_json ?? null,
    fastOptionsJson: row.fast_options_json ?? null,
    configAxesJson: row.config_axes_json ?? null,
  };
}

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
        models_json TEXT,
        thought_levels_json TEXT,
        fast_options_json TEXT,
        remote_session_id TEXT,
        resume_behavior TEXT
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

    const columns = new Set(
      (
        this.#db.query(`PRAGMA table_info(sessions)`).all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    if (!columns.has("remote_session_id")) {
      this.#db.exec(`ALTER TABLE sessions ADD COLUMN remote_session_id TEXT`);
    }
    if (!columns.has("resume_behavior")) {
      this.#db.exec(`ALTER TABLE sessions ADD COLUMN resume_behavior TEXT`);
    }
    if (!columns.has("thought_levels_json")) {
      this.#db.exec(`ALTER TABLE sessions ADD COLUMN thought_levels_json TEXT`);
    }
    if (!columns.has("fast_options_json")) {
      this.#db.exec(`ALTER TABLE sessions ADD COLUMN fast_options_json TEXT`);
    }
    if (!columns.has("config_axes_json")) {
      this.#db.exec(`ALTER TABLE sessions ADD COLUMN config_axes_json TEXT`);
    }
    this.#db.exec(`
      UPDATE sessions
      SET remote_session_id = session_id
      WHERE remote_session_id IS NULL OR remote_session_id = '';
      UPDATE sessions
      SET resume_behavior = 'native-load'
      WHERE resume_behavior IS NULL OR resume_behavior = '';
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
    thoughtLevelsJson?: string | null;
    fastOptionsJson?: string | null;
    configAxesJson?: string | null;
    remoteSessionId?: string | null;
    resumeBehavior?: ResumeBehavior | null;
  }): void {
    const updatedAt = row.updatedAt ?? row.createdAt;
    // null on update preserves an already-rotated remote id / resume strategy.
    const remoteSessionId = row.remoteSessionId ?? null;
    const resumeBehavior = row.resumeBehavior ?? null;
    this.#db
      .query(
        `INSERT INTO sessions (
          session_id, agent, cwd, title, created_at, updated_at, modes_json, models_json,
          thought_levels_json, fast_options_json, config_axes_json,
          remote_session_id, resume_behavior
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ?), COALESCE(?, 'native-load'))
        ON CONFLICT(session_id) DO UPDATE SET
          agent = excluded.agent,
          cwd = excluded.cwd,
          title = COALESCE(excluded.title, sessions.title),
          updated_at = excluded.updated_at,
          modes_json = COALESCE(excluded.modes_json, sessions.modes_json),
          models_json = COALESCE(excluded.models_json, sessions.models_json),
          thought_levels_json = COALESCE(excluded.thought_levels_json, sessions.thought_levels_json),
          fast_options_json = COALESCE(excluded.fast_options_json, sessions.fast_options_json),
          config_axes_json = COALESCE(excluded.config_axes_json, sessions.config_axes_json),
          remote_session_id = COALESCE(?, sessions.remote_session_id),
          resume_behavior = COALESCE(?, sessions.resume_behavior)`,
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
        row.thoughtLevelsJson ?? null,
        row.fastOptionsJson ?? null,
        row.configAxesJson ?? null,
        remoteSessionId,
        row.sessionId,
        resumeBehavior,
        remoteSessionId,
        resumeBehavior,
      );
  }

  /** Load failed / reconnect-fresh: rotate ACP id; UI local PK stays. */
  updateRemoteSession(
    localSessionId: string,
    remoteSessionId: string,
    resumeBehavior?: ResumeBehavior,
  ): boolean {
    const now = new Date().toISOString();
    const result = resumeBehavior
      ? this.#db
          .query(
            `UPDATE sessions
             SET remote_session_id = ?, resume_behavior = ?, updated_at = ?
             WHERE session_id = ?`,
          )
          .run(remoteSessionId, resumeBehavior, now, localSessionId)
      : this.#db
          .query(
            `UPDATE sessions
             SET remote_session_id = ?, updated_at = ?
             WHERE session_id = ?`,
          )
          .run(remoteSessionId, now, localSessionId);
    return result.changes > 0;
  }

  getSession(sessionId: string): PersistedSessionRow | null {
    const row = this.#db
      .query(
        `SELECT session_id, agent, cwd, title, created_at, updated_at, modes_json, models_json,
                thought_levels_json, fast_options_json, config_axes_json,
                remote_session_id, resume_behavior
         FROM sessions WHERE session_id = ?`,
      )
      .get(sessionId) as SessionQueryRow | null;
    if (!row) return null;
    return mapSessionRow(row);
  }

  listSessions(): PersistedSessionRow[] {
    const rows = this.#db
      .query(
        `SELECT session_id, agent, cwd, title, created_at, updated_at, modes_json, models_json,
                thought_levels_json, fast_options_json, config_axes_json,
                remote_session_id, resume_behavior
         FROM sessions
         ORDER BY updated_at DESC`,
      )
      .all() as SessionQueryRow[];
    return rows.map(mapSessionRow);
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
