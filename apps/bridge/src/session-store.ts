import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import type { UIMessage } from "ai";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { BridgeError } from "./errors.ts";
import {
  ApprovalManager,
  type PermissionRequestParams,
  type PermissionResponse,
} from "./approval-manager.ts";
import { classifySessionInitError } from "./session-errors.ts";
import { SessionDb, resolveSessionsDbPath } from "./session-db.ts";
import { normalizeAcpSessionConfig } from "./acp-session-config.ts";
import type { NormalizedAcpSessionConfig } from "./acp-session-config.ts";
import {
  sessionInfoToConfigDto,
  type SessionConfigDto,
} from "./session-config-dto.ts";
import { spawnAgentProvider } from "./agent/spawn.ts";

export type SessionInfo = {
  sessionId: string;
  agent: string;
  cwd: string;
  createdAt: string;
  updatedAt?: string;
  title?: string | null;
  modes?: {
    currentModeId?: string;
    availableModes?: Array<{
      id: string;
      name?: string;
      description?: string;
    }>;
  };
  models?: {
    currentModelId?: string;
    availableModels?: Array<{
      modelId: string;
      name?: string;
      description?: string;
    }>;
  };
  /** From ACP configOptions category=thought_level when advertised. */
  thoughtLevels?: {
    configId: string;
    currentId?: string;
    available: Array<{ id: string; name: string; description?: string }>;
  };
};

export type SessionEntry = {
  info: SessionInfo;
  provider: ACPProvider;
  approvals: ApprovalManager;
};

export type SessionStoreOptions = {
  /** SQLite path; default ~/.qenex/sessions.db or QENEX_SESSIONS_DB. */
  dbPath?: string;
  db?: SessionDb;
};

type PermissionAwareModel = {
  client?: {
    setPermissionRequestHandler?: (
      handler: (params: PermissionRequestParams) => Promise<PermissionResponse>,
    ) => void;
    readTextFile?: (params: {
      sessionId: string;
      path: string;
      line?: number | null;
      limit?: number | null;
    }) => Promise<{ content: string }> | { content: string };
    writeTextFile?: (params: {
      sessionId: string;
      path: string;
      content: string;
    }) => Promise<Record<string, never>> | Record<string, never>;
    sessionUpdate?: (params: {
      update?: {
        sessionUpdate?: string;
        status?: string | null;
        rawOutput?: unknown;
        content?: unknown;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }) => Promise<void>;
  };
};

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function installClientHandlers(
  provider: ACPProvider,
  approvals: ApprovalManager,
  cwd: string,
  sessionId: string,
): void {
  const model = provider.languageModel() as unknown as PermissionAwareModel;
  if (!model.client?.setPermissionRequestHandler) {
    throw new BridgeError(
      "permission_bridge_unavailable",
      "The installed ACP provider does not expose the permission callback required by Qenex. Check the pinned @mcpc-tech/acp-ai-provider version.",
      500,
    );
  }
  model.client.setPermissionRequestHandler((params) =>
    approvals.handlePermissionRequest(params),
  );

  const originalSessionUpdate = model.client.sessionUpdate?.bind(model.client);
  if (originalSessionUpdate) {
    model.client.sessionUpdate = (params) => {
      const update = params.update;
      // Provider 0.3.4's failed-tool formatter assumes rawOutput is iterable.
      // OpenCode can send `{}` there after a rejection; prefer ACP content.
      if (
        update?.sessionUpdate === "tool_call_update" &&
        update.status === "failed" &&
        !Array.isArray(update.rawOutput)
      ) {
        return originalSessionUpdate({
          ...params,
          update: {
            ...update,
            rawOutput: Array.isArray(update.content) ? update.content : [],
          },
        });
      }
      return originalSessionUpdate(params);
    };
  }

  // Provider 0.3.4 advertises fs support as false but OpenCode 1.18 can still
  // issue fs/* requests after an approved edit. Implement the ACP methods and
  // confine them to the real session workspace (including symlink checks).
  const realCwd = realpathSync(cwd);
  const assertSession = (received: string) => {
    if (received !== sessionId) {
      throw new Error(`ACP filesystem request has wrong sessionId: ${received}`);
    }
  };
  model.client.readTextFile = (params) => {
    assertSession(params.sessionId);
    const target = realpathSync(resolve(cwd, params.path));
    if (!isWithin(realCwd, target)) {
      throw new Error(`ACP read is outside the session workspace: ${params.path}`);
    }
    const content = readFileSync(target, "utf8");
    if (params.line == null && params.limit == null) return { content };
    const start = Math.max(0, (params.line ?? 1) - 1);
    const end = params.limit == null ? undefined : start + Math.max(0, params.limit);
    return { content: content.split("\n").slice(start, end).join("\n") };
  };
  model.client.writeTextFile = (params) => {
    assertSession(params.sessionId);
    const target = resolve(cwd, params.path);
    if (existsSync(target)) {
      const realTarget = realpathSync(target);
      if (!isWithin(realCwd, realTarget)) {
        throw new Error(`ACP write is outside the session workspace: ${params.path}`);
      }
    }
    const realParent = realpathSync(dirname(target));
    if (!isWithin(realCwd, realParent)) {
      throw new Error(`ACP write is outside the session workspace: ${params.path}`);
    }
    writeFileSync(target, params.content, "utf8");
    return {};
  };
}

function parseJsonField<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function infoFromRow(row: {
  sessionId: string;
  agent: string;
  cwd: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  modesJson: string | null;
  modelsJson: string | null;
}): SessionInfo {
  return {
    sessionId: row.sessionId,
    agent: (row.agent as SessionInfo["agent"]) || "opencode",
    cwd: row.cwd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: row.title,
    modes: parseJsonField(row.modesJson),
    models: parseJsonField(row.modelsJson),
  };
}

/** First user text → short local title (no ACP dependency). */
export function deriveTitleFromMessages(messages: UIMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = (message.parts ?? [])
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
    if (!text) continue;
    const collapsed = text.replace(/\s+/g, " ");
    return collapsed.length > 50 ? `${collapsed.slice(0, 50)}…` : collapsed;
  }
  return null;
}

export class SessionStore {
  #sessions = new Map<string, SessionEntry>();
  #db: SessionDb;
  /** Track reopen promises so concurrent GET/chat share one ACP attach. */
  #reopening = new Map<string, Promise<SessionEntry>>();
  /**
   * OpenCode `session/load` (existingSessionId) often omits `configOptions`.
   * Cache mode/model catalogs per cwd from create / probe.
   */
  #catalogByCwd = new Map<string, NormalizedAcpSessionConfig>();
  #catalogProbe = new Map<string, Promise<NormalizedAcpSessionConfig>>();

  constructor(options: SessionStoreOptions = {}) {
    this.#db =
      options.db ??
      new SessionDb(resolveSessionsDbPath(options.dbPath ?? null));
  }

  get dbPath(): string {
    return this.#db.path;
  }

  get size(): number {
    return this.#sessions.size;
  }

  /** Rows in SQLite (includes cold sessions not yet reopened). */
  get persistedCount(): number {
    return this.#db.listSessions().length;
  }

  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId) || this.#db.getSession(sessionId) != null;
  }

  /**
   * Live entry only. Prefer `ensureOpen` for chat / approvals (reopens from DB).
   */
  get(sessionId: string): SessionEntry {
    const entry = this.#sessions.get(sessionId);
    if (!entry) {
      throw new BridgeError(
        "session_not_found",
        `Session not found: ${sessionId}`,
        404,
      );
    }
    return entry;
  }

  /** Session metadata from memory or SQLite (does not spawn ACP). */
  getInfo(sessionId: string): SessionInfo {
    const live = this.#sessions.get(sessionId);
    if (live) return live.info;
    const row = this.#db.getSession(sessionId);
    if (!row) {
      throw new BridgeError(
        "session_not_found",
        `Session not found: ${sessionId}`,
        404,
      );
    }
    return infoFromRow(row);
  }

  list(): SessionInfo[] {
    const fromDb = this.#db.listSessions().map(infoFromRow);
    // Prefer live info (fresh modes/models) when present.
    return fromDb.map((info) => this.#sessions.get(info.sessionId)?.info ?? info);
  }

  async create(input: {
    cwd: string;
    agentId?: string;
    agentCommand?: string[];
  }): Promise<SessionInfo> {
    const cwd = resolve(input.cwd);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new BridgeError(
        "invalid_cwd",
        `cwd must be an existing directory: ${cwd}`,
        400,
      );
    }

    const spawned = spawnAgentProvider({
      cwd,
      agentId: input.agentId,
      agentCommand: input.agentCommand,
      persistSession: true,
    });
    const { provider, agentId } = spawned;
    const approvals = new ApprovalManager();

    try {
      const session = await provider.initSession();
      const sessionId = session.sessionId;
      if (!sessionId) {
        throw new BridgeError(
          "session_init_failed",
          `${agentId} ACP initSession did not return a sessionId`,
          502,
        );
      }
      installClientHandlers(provider, approvals, cwd, sessionId);

      const createdAt = new Date().toISOString();
      const normalized = normalizeAcpSessionConfig(session);
      const modes = normalized.modes;
      const models = normalized.models;
      const thoughtLevels = normalized.thoughtLevels;
      this.#rememberCatalog(cwd, normalized);

      const info: SessionInfo = {
        sessionId,
        agent: agentId,
        cwd,
        createdAt,
        updatedAt: createdAt,
        title: null,
        modes,
        models,
        thoughtLevels,
      };

      this.#db.upsertSession({
        sessionId,
        agent: info.agent,
        cwd,
        title: null,
        createdAt,
        updatedAt: createdAt,
        modesJson: modes ? JSON.stringify(modes) : null,
        modelsJson: models ? JSON.stringify(models) : null,
      });

      this.#sessions.set(sessionId, { info, provider, approvals });
      return info;
    } catch (err) {
      try {
        provider.cleanup();
      } catch {
        /* ignore */
      }
      throw classifySessionInitError(err, agentId);
    }
  }

  /**
   * Ensure ACP provider is live for this sessionId (reopen from SQLite after Bridge restart).
   */
  async ensureOpen(sessionId: string): Promise<SessionEntry> {
    const live = this.#sessions.get(sessionId);
    if (live) return live;

    const pending = this.#reopening.get(sessionId);
    if (pending) return pending;

    const promise = this.#reopen(sessionId).finally(() => {
      this.#reopening.delete(sessionId);
    });
    this.#reopening.set(sessionId, promise);
    return promise;
  }

  async #reopen(sessionId: string): Promise<SessionEntry> {
    const row = this.#db.getSession(sessionId);
    if (!row) {
      throw new BridgeError(
        "session_not_found",
        `Session not found: ${sessionId}`,
        404,
      );
    }

    const cwd = resolve(row.cwd);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new BridgeError(
        "invalid_cwd",
        `Persisted session cwd is missing: ${cwd}`,
        400,
      );
    }

    const spawned = spawnAgentProvider({
      cwd,
      agentId: row.agent || "opencode",
      existingSessionId: sessionId,
      persistSession: true,
    });
    const { provider } = spawned;
    const approvals = new ApprovalManager();

    try {
      const session = await provider.initSession();
      installClientHandlers(provider, approvals, cwd, sessionId);
      const info = infoFromRow(row);
      // Refresh mode/model catalogs from live ACP (configOptions / legacy).
      const normalized = normalizeAcpSessionConfig(session);
      if (normalized.modes) info.modes = normalized.modes;
      if (normalized.models) info.models = normalized.models;
      if (normalized.thoughtLevels) info.thoughtLevels = normalized.thoughtLevels;
      this.#rememberCatalog(cwd, normalized);
      if (normalized.modes || normalized.models || normalized.thoughtLevels) {
        this.#persistInfo(info);
      }
      const entry: SessionEntry = { info, provider, approvals };
      this.#sessions.set(sessionId, entry);
      await this.#ensureSessionCatalog(entry);
      return entry;
    } catch (err) {
      try {
        provider.cleanup();
      } catch {
        /* ignore */
      }
      throw classifySessionInitError(err, spawned.agentId);
    }
  }

  getMessages(sessionId: string): UIMessage[] {
    // Existence check (DB or memory).
    this.getInfo(sessionId);
    return this.#db.getMessages(sessionId);
  }

  /** Session mode/model config for the frontend SessionConfigBar. */
  async getConfig(sessionId: string): Promise<SessionConfigDto> {
    const entry = await this.ensureOpen(sessionId);
    await this.#ensureSessionCatalog(entry);
    return sessionInfoToConfigDto(entry.info);
  }

  async setMode(sessionId: string, modeId: string): Promise<SessionConfigDto> {
    const trimmed = modeId.trim();
    if (!trimmed) {
      throw new BridgeError("invalid_mode", "modeId must be a non-empty string", 400);
    }
    const entry = await this.ensureOpen(sessionId);
    await this.#ensureSessionCatalog(entry);
    try {
      await entry.provider.setMode(trimmed);
    } catch (err) {
      throw new BridgeError(
        "set_mode_failed",
        err instanceof Error ? err.message : String(err),
        502,
      );
    }
    const modes = {
      currentModeId: trimmed,
      availableModes: entry.info.modes?.availableModes ?? [],
    };
    entry.info = {
      ...entry.info,
      modes,
      updatedAt: new Date().toISOString(),
    };
    this.#persistInfo(entry.info);
    return sessionInfoToConfigDto(entry.info);
  }

  async setModel(sessionId: string, modelId: string): Promise<SessionConfigDto> {
    const trimmed = modelId.trim();
    if (!trimmed) {
      throw new BridgeError(
        "invalid_model",
        "modelId must be a non-empty string",
        400,
      );
    }
    const entry = await this.ensureOpen(sessionId);
    await this.#ensureSessionCatalog(entry);
    try {
      await entry.provider.setModel(trimmed);
    } catch (err) {
      throw new BridgeError(
        "set_model_failed",
        err instanceof Error ? err.message : String(err),
        502,
      );
    }
    const models = {
      currentModelId: trimmed,
      availableModels: entry.info.models?.availableModels ?? [],
    };
    entry.info = {
      ...entry.info,
      models,
      updatedAt: new Date().toISOString(),
    };
    this.#persistInfo(entry.info);
    return sessionInfoToConfigDto(entry.info);
  }

  #rememberCatalog(cwd: string, normalized: NormalizedAcpSessionConfig): void {
    const hasModes = (normalized.modes?.availableModes?.length ?? 0) > 0;
    const hasModels = (normalized.models?.availableModels?.length ?? 0) > 0;
    if (!hasModes && !hasModels && !normalized.thoughtLevels) return;
    const prev = this.#catalogByCwd.get(cwd) ?? {};
    this.#catalogByCwd.set(cwd, {
      modes: hasModes ? normalized.modes : prev.modes,
      models: hasModels ? normalized.models : prev.models,
      thoughtLevels: normalized.thoughtLevels ?? prev.thoughtLevels,
    });
  }

  /**
   * When loadSession omits catalogs, fill from cwd cache or a throwaway session/new probe.
   */
  async #ensureSessionCatalog(entry: SessionEntry): Promise<void> {
    const hasModes = (entry.info.modes?.availableModes?.length ?? 0) > 0;
    const hasModels = (entry.info.models?.availableModels?.length ?? 0) > 0;
    if (hasModes && hasModels) {
      this.#rememberCatalog(entry.info.cwd, {
        modes: entry.info.modes,
        models: entry.info.models,
        thoughtLevels: entry.info.thoughtLevels,
      });
      return;
    }

    let catalog = this.#catalogByCwd.get(entry.info.cwd);
    const cacheOk =
      (catalog?.modes?.availableModes?.length ?? 0) > 0 &&
      (catalog?.models?.availableModels?.length ?? 0) > 0;
    if (!cacheOk) {
      catalog = await this.#probeCatalog(entry.info.cwd, entry.info.agent);
    }
    if (!catalog) return;

    let changed = false;
    if (!hasModes && catalog.modes?.availableModes?.length) {
      entry.info.modes = {
        currentModeId:
          entry.info.modes?.currentModeId ?? catalog.modes.currentModeId,
        availableModes: catalog.modes.availableModes,
      };
      changed = true;
    }
    if (!hasModels && catalog.models?.availableModels?.length) {
      entry.info.models = {
        currentModelId:
          entry.info.models?.currentModelId ?? catalog.models.currentModelId,
        availableModels: catalog.models.availableModels,
      };
      changed = true;
    }
    if (!entry.info.thoughtLevels && catalog.thoughtLevels) {
      entry.info.thoughtLevels = catalog.thoughtLevels;
      changed = true;
    }
    if (changed) {
      entry.info = {
        ...entry.info,
        updatedAt: new Date().toISOString(),
      };
      this.#persistInfo(entry.info);
    }
  }

  async #probeCatalog(
    cwd: string,
    agentId = "opencode",
  ): Promise<NormalizedAcpSessionConfig> {
    const key = `${agentId}::${cwd}`;
    const pending = this.#catalogProbe.get(key);
    if (pending) return pending;

    const promise = (async (): Promise<NormalizedAcpSessionConfig> => {
      const spawned = spawnAgentProvider({
        cwd,
        agentId,
        persistSession: false,
      });
      const { provider } = spawned;
      try {
        const session = await provider.initSession();
        const normalized = normalizeAcpSessionConfig(session);
        this.#rememberCatalog(cwd, normalized);
        return normalized;
      } finally {
        try {
          provider.cleanup();
        } catch {
          /* ignore */
        }
      }
    })();

    this.#catalogProbe.set(key, promise);
    try {
      return await promise;
    } finally {
      this.#catalogProbe.delete(key);
    }
  }

  #persistInfo(info: SessionInfo): void {
    this.#db.upsertSession({
      sessionId: info.sessionId,
      agent: info.agent,
      cwd: info.cwd,
      title: info.title ?? null,
      createdAt: info.createdAt,
      updatedAt: info.updatedAt ?? new Date().toISOString(),
      modesJson: info.modes ? JSON.stringify(info.modes) : null,
      modelsJson: info.models ? JSON.stringify(info.models) : null,
    });
  }

  saveMessages(sessionId: string, messages: UIMessage[]): SessionInfo {
    const info = this.getInfo(sessionId);
    this.#db.replaceMessages(sessionId, messages);

    const derived = deriveTitleFromMessages(messages);
    if (derived && (!info.title || info.title === "新会话")) {
      this.#db.setTitle(sessionId, derived);
    } else {
      this.#db.touch(sessionId);
    }

    return this.#refreshInfo(sessionId);
  }

  updateTitle(sessionId: string, title: string): SessionInfo {
    const trimmed = title.trim();
    if (!trimmed) {
      throw new BridgeError("invalid_title", "title must be a non-empty string", 400);
    }
    if (!this.#db.setTitle(sessionId, trimmed)) {
      throw new BridgeError(
        "session_not_found",
        `Session not found: ${sessionId}`,
        404,
      );
    }
    return this.#refreshInfo(sessionId);
  }

  /** Re-read SQLite row into live entry (if any) and return fresh info. */
  #refreshInfo(sessionId: string): SessionInfo {
    const row = this.#db.getSession(sessionId);
    if (!row) {
      throw new BridgeError(
        "session_not_found",
        `Session not found: ${sessionId}`,
        404,
      );
    }
    const next = infoFromRow(row);
    const live = this.#sessions.get(sessionId);
    if (live) live.info = next;
    return next;
  }

  delete(sessionId: string): void {
    const live = this.#sessions.get(sessionId);
    const inDb = this.#db.getSession(sessionId) != null;
    if (!live && !inDb) {
      throw new BridgeError(
        "session_not_found",
        `Session not found: ${sessionId}`,
        404,
      );
    }
    if (live) {
      this.#sessions.delete(sessionId);
      live.approvals.cancelAll();
      try {
        live.provider.cleanup();
      } catch {
        /* ignore cleanup errors */
      }
    }
    this.#db.deleteSession(sessionId);
  }

  /**
   * Tear down live ACP processes; keep SQLite (Bridge restart / graceful stop).
   */
  dispose(): void {
    for (const id of [...this.#sessions.keys()]) {
      const entry = this.#sessions.get(id);
      this.#sessions.delete(id);
      if (!entry) continue;
      entry.approvals.cancelAll();
      try {
        entry.provider.cleanup();
      } catch {
        /* ignore */
      }
    }
    this.#reopening.clear();
  }

  /**
   * Tear down live sessions and wipe SQLite (tests only).
   */
  clear(): void {
    this.dispose();
    this.#db.deleteAllSessions();
  }

  closeDb(): void {
    this.#db.close();
  }
}

export const sessions = new SessionStore();
// Note: production entry (`index.ts`) constructs its own SessionStore via
// startBridgeServer({ dbPath }). This singleton is for ad-hoc imports only.
