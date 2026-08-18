import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import type { UIMessage } from "ai";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyCompatCatalog,
  resolveAgentCompat,
} from "./agent/compat/registry.ts";
import {
  errorText,
  cliLoginCommand,
  isAuthRequiredErrorCode,
  normalizeAuthMethods,
  type ConfigDiscovery,
  type ResumeBehavior,
} from "./agent/compat/types.ts";
import {
  forceCleanupProvider,
  installClientHandlers,
  setSessionConfigOption,
} from "./agent/runtime/provider-compat.ts";
import {
  rejectWhenAborted,
  SessionOperationQueue,
  type SessionOpKind,
  type SessionOpLease,
} from "./agent/runtime/session-operation-queue.ts";
import { spawnAgentProvider } from "./agent/spawn.ts";
import { ApprovalManager } from "./approval-manager.ts";
import { BridgeError } from "./errors.ts";
import {
  MODE_THOUGHT_CONFIG_ID,
  normalizeAcpSessionConfig,
} from "./acp-session-config.ts";
import type {
  AcpModelAxes,
  AcpThoughtState,
  NormalizedAcpSessionConfig,
} from "./acp-session-config.ts";
import {
  overlayDtoWithModelAxes,
  sessionInfoToConfigDto,
  type SessionConfigDto,
} from "./session-config-dto.ts";
import { classifySessionInitError } from "./session-errors.ts";
import { SessionDb, resolveSessionsDbPath, type GetMessagesOptions } from "./session-db.ts";

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
  thoughtLevels?: AcpThoughtState;
  /** Optional Fast/speed config advertised through ACP configOptions. */
  fastOptions?: AcpThoughtState;
  contextOptions?: AcpThoughtState;
  thinkingOptions?: AcpThoughtState;
  /** Per-canonical-model axes from cartesian ads; not a probe result. */
  modelConfigById?: Record<string, AcpModelAxes>;
};

export type SessionEntry = {
  info: SessionInfo;
  /** ACP session id. Rotates on load failure; UI keeps info.sessionId. */
  remoteSessionId: string;
  resumeBehavior: ResumeBehavior;
  provider: ACPProvider;
  approvals: ApprovalManager;
};

export type SessionStoreOptions = {
  /** SQLite path; default ~/.qenex/sessions.db or QENEX_SESSIONS_DB. */
  dbPath?: string;
  db?: SessionDb;
  operations?: SessionOperationQueue;
};

export function catalogCacheKey(agentId: string, cwd: string): string {
  return `${agentId}::${cwd}`;
}

/**
 * Prefer an already-running ACP process's advertised catalog over a throwaway
 * `session/new` probe. Incomplete live entries (typical `session/load`) are
 * skipped so reopen-after-restart can still throwaway-probe.
 */
export function liveCatalogForProbe(
  live: Iterable<{ info: SessionInfo }>,
  agentId: string,
  cwd: string,
): NormalizedAcpSessionConfig | undefined {
  for (const entry of live) {
    if (entry.info.agent !== agentId || entry.info.cwd !== cwd) continue;
    const info = entry.info;
    const hasModes = (info.modes?.availableModes?.length ?? 0) > 0;
    const hasModels = (info.models?.availableModels?.length ?? 0) > 0;
    if (
      !hasModes &&
      !hasModels &&
      !info.thoughtLevels &&
      !info.fastOptions &&
      !info.contextOptions &&
      !info.thinkingOptions &&
      !info.modelConfigById
    ) {
      continue;
    }
    return {
      modes: info.modes,
      models: info.models,
      thoughtLevels: info.thoughtLevels,
      fastOptions: info.fastOptions,
      contextOptions: info.contextOptions,
      thinkingOptions: info.thinkingOptions,
      modelConfigById: info.modelConfigById,
    };
  }
  return undefined;
}

/** Mode/model catalogs keyed by agentId + cwd (never agentVersion). */
export class AgentCatalogCache {
  #map = new Map<string, NormalizedAcpSessionConfig>();

  remember(
    agentId: string,
    cwd: string,
    normalized: NormalizedAcpSessionConfig,
  ): void {
    const hasModes = (normalized.modes?.availableModes?.length ?? 0) > 0;
    const hasModels = (normalized.models?.availableModels?.length ?? 0) > 0;
    if (
      !hasModes &&
      !hasModels &&
      !normalized.thoughtLevels &&
      !normalized.fastOptions &&
      !normalized.contextOptions &&
      !normalized.thinkingOptions &&
      !normalized.modelConfigById
    ) {
      return;
    }
    const key = catalogCacheKey(agentId, cwd);
    const prev = this.#map.get(key) ?? {};
    this.#map.set(key, {
      modes: hasModes ? normalized.modes : prev.modes,
      models: hasModels ? normalized.models : prev.models,
      thoughtLevels: normalized.thoughtLevels ?? prev.thoughtLevels,
      fastOptions: normalized.fastOptions ?? prev.fastOptions,
      contextOptions: normalized.contextOptions ?? prev.contextOptions,
      thinkingOptions: normalized.thinkingOptions ?? prev.thinkingOptions,
      modelConfigById: normalized.modelConfigById
        ? { ...prev.modelConfigById, ...normalized.modelConfigById }
        : prev.modelConfigById,
    });
  }

  get(agentId: string, cwd: string): NormalizedAcpSessionConfig | undefined {
    return this.#map.get(catalogCacheKey(agentId, cwd));
  }
}

const configuredSessionInitTimeout = Number(
  process.env.QENEX_SESSION_INIT_TIMEOUT_MS ?? 90_000,
);
const SESSION_INIT_TIMEOUT_MS =
  Number.isFinite(configuredSessionInitTimeout) && configuredSessionInitTimeout > 0
    ? configuredSessionInitTimeout
    : 45_000;

const configuredSessionAuthTimeout = Number(
  process.env.QENEX_SESSION_AUTH_TIMEOUT_MS ?? 300_000,
);
const SESSION_AUTH_TIMEOUT_MS =
  Number.isFinite(configuredSessionAuthTimeout) && configuredSessionAuthTimeout > 0
    ? configuredSessionAuthTimeout
    : 300_000;

async function raceWithSignal<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutError: BridgeError,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    abortHandler = () =>
      reject(
        new BridgeError("request_aborted", "Session creation was cancelled", 499),
      );
    if (signal.aborted) abortHandler();
    else signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([work, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

async function initProviderSession(
  provider: ACPProvider,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<ACPProvider["initSession"]>>> {
  return raceWithSignal(
    provider.initSession(),
    signal,
    SESSION_INIT_TIMEOUT_MS,
    new BridgeError(
      "session_init_timeout",
      `Agent did not initialize within ${SESSION_INIT_TIMEOUT_MS}ms`,
      504,
    ),
  );
}

function authMethodsFromClassified(err: BridgeError): unknown {
  const details = err.details;
  if (!details || typeof details !== "object") return undefined;
  return (details as { methods?: unknown }).methods;
}

export type InteractiveAuthInitInput = {
  provider: ACPProvider;
  agentId: string;
  launchCommand: string[];
  signal?: AbortSignal;
  respawn?: () => ACPProvider;
  runLogin?: (command: string[]) => Promise<void>;
};

async function runCliBrowserLogin(
  command: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (command.length === 0) {
    throw new BridgeError("auth_required", "Login command is empty", 409);
  }
  const proc = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  try {
    const code = await raceWithSignal(
      proc.exited,
      signal,
      SESSION_AUTH_TIMEOUT_MS,
      new BridgeError(
        "session_auth_timeout",
        `Agent login did not complete within ${SESSION_AUTH_TIMEOUT_MS}ms`,
        504,
      ),
    );
    if (code !== 0) {
      throw new BridgeError(
        "auth_required",
        `Browser login exited with code ${code}`,
        409,
      );
    }
  } catch (error) {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    throw error;
  }
}

function rethrowAuthFailure(
  classified: BridgeError,
  authErr: unknown,
  agentId: string,
  authMethods: unknown,
): never {
  if (authErr instanceof BridgeError && authErr.code === "request_aborted") {
    throw authErr;
  }
  const retryClassified = classifySessionInitError(authErr, agentId, {
    authMethods,
  });
  if (
    retryClassified.code === "session_auth_timeout" ||
    isAuthRequiredErrorCode(retryClassified.code)
  ) {
    throw new BridgeError(
      classified.code,
      classified.message,
      classified.status,
      {
        ...(typeof classified.details === "object" && classified.details
          ? classified.details
          : { cause: errorText(authErr), agentId }),
        methods:
          authMethodsFromClassified(retryClassified) ??
          authMethodsFromClassified(classified) ??
          authMethods,
      },
    );
  }
  throw retryClassified;
}

/**
 * Try session/new first. On `auth_required`:
 * 1. If the Agent has `loginArgv`, spawn `<bin> login` (Cursor opens the
 *    account browser). Respawn ACP afterwards so the new process sees credentials.
 * 2. Otherwise do not call ACP `authenticate` again — `initSession` already ran
 *    provider lazy-auth (Gemini opens Google there). A second authenticate
 *    pops another login page after the first already succeeded.
 * Timeouts stay timeouts — do not open a login page for a slow but logged-in Agent.
 */
export async function initProviderSessionWithInteractiveAuth(
  input: InteractiveAuthInitInput,
): Promise<{
  session: Awaited<ReturnType<ACPProvider["initSession"]>>;
  provider: ACPProvider;
}> {
  let provider = input.provider;
  const { agentId, signal } = input;
  try {
    const session = await initProviderSession(provider, signal);
    return { session, provider };
  } catch (firstErr) {
    const authMethods = readProviderAuthMethods(provider);
    const classified = classifySessionInitError(firstErr, agentId, { authMethods });
    if (!isAuthRequiredErrorCode(classified.code)) {
      throw classified;
    }
    const loginCmd = cliLoginCommand(
      input.launchCommand,
      resolveAgentCompat(agentId).loginArgv,
    );
    if (!loginCmd) {
      throw classified;
    }
    try {
      if (input.runLogin) await input.runLogin(loginCmd);
      else await runCliBrowserLogin(loginCmd, signal);
      if (input.respawn) {
        provider = input.respawn();
      }
      const retrySession = await initProviderSession(provider, signal);
      return { session: retrySession, provider };
    } catch (authErr) {
      return rethrowAuthFailure(
        classified,
        authErr,
        agentId,
        readProviderAuthMethods(provider).length > 0
          ? readProviderAuthMethods(provider)
          : authMethods,
      );
    }
  }
}

export function isMissingProviderSessionError(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return (
    message.includes("no previous sessions found") ||
    message.includes("session not found") ||
    message.includes("unknown session") ||
    message.includes("cannot load session") ||
    message.includes("no rollout found")
  );
}

/**
 * Best-effort restore of the live session model after a same-session probe.
 * Always attempts restore even if the probe itself failed; swallows restore
 * RPC errors so the probe result (or original failure) can still surface.
 */
/**
 * Skip switching the live model when the snapshot is already known.
 * Advertised + session-level thought (Codex) must not probe; advertised with
 * empty thought (legacy OpenCode) and per-model-probe-fallback still probe.
 */
export function shouldSkipModelConfigProbe(input: {
  configDiscovery: ConfigDiscovery;
  currentModelId: string | null;
  requestedModelId: string;
  hasCachedSnapshot: boolean;
  liveHasThoughtOrFast: boolean;
  hasAdvertisedModelSnapshot?: boolean;
  hasPerModelAdvertisedMap?: boolean;
}): boolean {
  if (input.currentModelId === input.requestedModelId) return true;
  if (input.hasCachedSnapshot) return true;
  if (input.hasAdvertisedModelSnapshot) return true;
  // Session-level advertised thought (no cartesian per-model map): same
  // options apply to every model; do not switch. Per-model maps must not
  // copy the live union onto another model.
  return (
    input.configDiscovery === "advertised" &&
    input.liveHasThoughtOrFast &&
    !input.hasPerModelAdvertisedMap
  );
}

/**
 * Create-time: one set_config_option(current model) so GET /config already
 * has thought/fast. Advertised agents must not take this path. Do not put
 * this on the getConfig hot path (it shares the session op queue with chat).
 */
export function shouldSelfProbeCurrentModel(input: {
  configDiscovery: ConfigDiscovery;
  currentModelId: string | null;
  liveHasThoughtOrFast: boolean;
}): boolean {
  if (input.configDiscovery !== "per-model-probe-fallback") return false;
  if (!input.currentModelId) return false;
  return !input.liveHasThoughtOrFast;
}

export async function restoreProbedModel(input: {
  originalModelId: string | null | undefined;
  currentModelId?: string | null;
  restore: (modelId: string) => Promise<unknown>;
}): Promise<"restored" | "skipped" | "failed"> {
  const original = input.originalModelId?.trim() ?? "";
  if (!original) return "skipped";
  if (input.currentModelId === original) return "skipped";
  try {
    await input.restore(original);
    return "restored";
  } catch {
    return "failed";
  }
}

function readProviderAuthMethods(provider: ACPProvider): unknown[] {
  try {
    const model = provider.languageModel() as unknown as {
      availableAuthMethodIds?: unknown;
    };
    return normalizeAuthMethods(model.availableAuthMethodIds);
  } catch {
    return [];
  }
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
  thoughtLevelsJson: string | null;
  fastOptionsJson: string | null;
  configAxesJson?: string | null;
}): SessionInfo {
  const axes = parseJsonField<{
    contextOptions?: SessionInfo["contextOptions"];
    thinkingOptions?: SessionInfo["thinkingOptions"];
    modelConfigById?: SessionInfo["modelConfigById"];
  }>(row.configAxesJson);
  return applyInfoCatalog({
    sessionId: row.sessionId,
    agent: (row.agent as SessionInfo["agent"]) || "opencode",
    cwd: row.cwd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: row.title,
    modes: parseJsonField(row.modesJson),
    models: parseJsonField(row.modelsJson),
    thoughtLevels: parseJsonField(row.thoughtLevelsJson),
    fastOptions: parseJsonField(row.fastOptionsJson),
    contextOptions: axes?.contextOptions,
    thinkingOptions: axes?.thinkingOptions,
    modelConfigById: axes?.modelConfigById,
  });
}

/** Replay per-agent catalog rewrites on DB-hydrated or in-memory info. */
function applyInfoCatalog(info: SessionInfo): SessionInfo {
  const normalized = applyCompatCatalog(info.agent, {
    modes: info.modes,
    models: info.models,
    thoughtLevels: info.thoughtLevels,
    fastOptions: info.fastOptions,
    contextOptions: info.contextOptions,
    thinkingOptions: info.thinkingOptions,
    modelConfigById: info.modelConfigById,
  });
  return {
    ...info,
    modes: normalized.modes,
    models: normalized.models,
    thoughtLevels: normalized.thoughtLevels,
    fastOptions: normalized.fastOptions,
    contextOptions: normalized.contextOptions ?? info.contextOptions,
    thinkingOptions: normalized.thinkingOptions ?? info.thinkingOptions,
    modelConfigById: normalized.modelConfigById ?? info.modelConfigById,
  };
}

function catalogPersistFields(info: {
  modes?: SessionInfo["modes"];
  models?: SessionInfo["models"];
  thoughtLevels?: SessionInfo["thoughtLevels"];
  fastOptions?: SessionInfo["fastOptions"];
  contextOptions?: SessionInfo["contextOptions"];
  thinkingOptions?: SessionInfo["thinkingOptions"];
  modelConfigById?: SessionInfo["modelConfigById"];
}): {
  modesJson: string | null;
  modelsJson: string | null;
  thoughtLevelsJson: string | null;
  fastOptionsJson: string | null;
  configAxesJson: string | null;
} {
  const axes =
    info.contextOptions || info.thinkingOptions || info.modelConfigById
      ? {
          contextOptions: info.contextOptions,
          thinkingOptions: info.thinkingOptions,
          modelConfigById: info.modelConfigById,
        }
      : null;
  return {
    modesJson: info.modes ? JSON.stringify(info.modes) : null,
    modelsJson: info.models ? JSON.stringify(info.models) : null,
    thoughtLevelsJson: info.thoughtLevels
      ? JSON.stringify(info.thoughtLevels)
      : null,
    fastOptionsJson: info.fastOptions ? JSON.stringify(info.fastOptions) : null,
    configAxesJson: axes ? JSON.stringify(axes) : null,
  };
}

function hasFullCatalog(info: SessionInfo): boolean {
  const hasModels = (info.models?.availableModels?.length ?? 0) > 0;
  const hasModes = (info.modes?.availableModes?.length ?? 0) > 0;
  const hasThought = (info.thoughtLevels?.available?.length ?? 0) > 0;
  return hasModels && (hasModes || hasThought);
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
  #ops: SessionOperationQueue;
  /** Track reopen promises so concurrent GET/chat share one ACP attach. */
  #reopening = new Map<string, Promise<SessionEntry>>();
  /**
   * OpenCode `session/load` often omits `configOptions`.
   * Cache mode/model catalogs per agentId + cwd from create / probe.
   */
  #catalog = new AgentCatalogCache();
  #catalogProbe = new Map<string, Promise<NormalizedAcpSessionConfig>>();
  #modelConfigBySession = new Map<string, Map<string, SessionConfigDto>>();

  constructor(options: SessionStoreOptions = {}) {
    this.#db =
      options.db ??
      new SessionDb(resolveSessionsDbPath(options.dbPath ?? null));
    this.#ops = options.operations ?? new SessionOperationQueue();
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

  /** Test helper: inspect per-agent catalog isolation. */
  get catalog(): AgentCatalogCache {
    return this.#catalog;
  }

  get sessionOperations(): SessionOperationQueue {
    return this.#ops;
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

  acquireSessionOperation(
    sessionId: string,
    kind: SessionOpKind,
  ): Promise<SessionOpLease> {
    return this.#ops.acquire(sessionId, kind);
  }

  interruptSessionOperation(sessionId: string): void {
    this.#ops.interrupt(sessionId);
  }

  async #withSessionOp<T>(
    sessionId: string,
    kind: SessionOpKind,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.#ops.run(sessionId, kind, fn);
  }

  async create(input: {
    cwd: string;
    agentId?: string;
    agentCommand?: string[];
    signal?: AbortSignal;
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
    let { provider, agentId } = spawned;
    const approvals = new ApprovalManager();
    const compat = resolveAgentCompat(agentId);

    try {
      const inited = await initProviderSessionWithInteractiveAuth({
        provider,
        agentId,
        launchCommand: spawned.command,
        signal: input.signal,
        respawn: () => {
          forceCleanupProvider(provider);
          const next = spawnAgentProvider({
            cwd,
            agentId: input.agentId,
            agentCommand: input.agentCommand,
            persistSession: true,
          });
          provider = next.provider;
          return provider;
        },
      });
      provider = inited.provider;
      const session = inited.session;
      const sessionId = session.sessionId;
      if (!sessionId) {
        throw new BridgeError(
          "session_init_failed",
          `${agentId} ACP initSession did not return a sessionId`,
          502,
        );
      }
      let entry: SessionEntry | null = null;
      let pendingConfigOptions: unknown = null;
      installClientHandlers(provider, approvals, cwd, sessionId, (options) => {
        if (entry) this.#applyConfigOptions(entry, options);
        else pendingConfigOptions = options;
      });

      const createdAt = new Date().toISOString();
      const normalized = this.#compatCatalog(
        agentId,
        normalizeAcpSessionConfig(session),
      );
      const modes = normalized.modes;
      const models = normalized.models;
      const thoughtLevels = normalized.thoughtLevels;
      const fastOptions = normalized.fastOptions;
      const contextOptions = normalized.contextOptions;
      const thinkingOptions = normalized.thinkingOptions;
      const modelConfigById = normalized.modelConfigById;
      this.#rememberCatalog(agentId, cwd, normalized);

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
        fastOptions,
        contextOptions,
        thinkingOptions,
        modelConfigById,
      };

      this.#db.upsertSession({
        sessionId,
        remoteSessionId: sessionId,
        resumeBehavior: compat.resume,
        agent: info.agent,
        cwd,
        title: null,
        createdAt,
        updatedAt: createdAt,
        ...catalogPersistFields({
          modes,
          models,
          thoughtLevels,
          fastOptions,
          contextOptions,
          thinkingOptions,
          modelConfigById,
        }),
      });

      entry = {
        info,
        remoteSessionId: sessionId,
        resumeBehavior: compat.resume,
        provider,
        approvals,
      };
      this.#sessions.set(sessionId, entry);
      if (pendingConfigOptions) {
        this.#applyConfigOptions(entry, pendingConfigOptions);
      }
      const liveHasThoughtOrFast =
        (entry.info.thoughtLevels?.available?.length ?? 0) > 0 ||
        (entry.info.fastOptions?.available?.length ?? 0) > 0;
      const currentModelId = entry.info.models?.currentModelId ?? null;
      this.#rememberModelConfig(
        sessionId,
        sessionInfoToConfigDto(entry.info),
      );
      if (
        shouldSelfProbeCurrentModel({
          configDiscovery: compat.configDiscovery,
          currentModelId,
          liveHasThoughtOrFast,
        }) &&
        currentModelId
      ) {
        // Do not block HTTP 201. GET /config and model-config still pick up
        // thought/fast after this queued probe (or via ensureSessionCatalog).
        void this.#withSessionOp(sessionId, "set-model", async (signal) => {
          const live = this.#sessions.get(sessionId);
          if (!live) return;
          try {
            const dto = await this.#setModelUnlocked(
              live,
              currentModelId,
              signal,
            );
            this.#rememberModelConfig(sessionId, dto);
          } catch (err) {
            console.error(
              "[qenex-bridge] create self-probe failed:",
              errorText(err),
            );
          }
        }).catch((err) => {
          console.error(
            "[qenex-bridge] create self-probe failed:",
            errorText(err),
          );
        });
      }
      return entry.info;
    } catch (err) {
      const authMethods = readProviderAuthMethods(provider);
      try {
        provider.cleanup();
      } catch {
        /* ignore */
      }
      throw classifySessionInitError(err, agentId, { authMethods });
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

    const agentId = row.agent || "opencode";
    const compat = resolveAgentCompat(agentId);
    const storedRemote = row.remoteSessionId || sessionId;
    const tryLoad = compat.resume === "native-load";

    let spawned = spawnAgentProvider({
      cwd,
      agentId,
      existingSessionId: tryLoad ? storedRemote : undefined,
      persistSession: true,
    });
    let provider = spawned.provider;
    const approvals = new ApprovalManager();

    try {
      let session: Awaited<ReturnType<ACPProvider["initSession"]>>;
      try {
        const inited = await initProviderSessionWithInteractiveAuth({
          provider,
          agentId,
          launchCommand: spawned.command,
          respawn: () => {
            forceCleanupProvider(provider);
            spawned = spawnAgentProvider({
              cwd,
              agentId,
              existingSessionId: tryLoad ? storedRemote : undefined,
              persistSession: true,
            });
            provider = spawned.provider;
            return provider;
          },
        });
        provider = inited.provider;
        session = inited.session;
      } catch (error) {
        if (!tryLoad || !isMissingProviderSessionError(error)) throw error;
        forceCleanupProvider(provider);
        spawned = spawnAgentProvider({
          cwd,
          agentId,
          persistSession: true,
        });
        provider = spawned.provider;
        const inited = await initProviderSessionWithInteractiveAuth({
          provider,
          agentId: spawned.agentId,
          launchCommand: spawned.command,
          respawn: () => {
            forceCleanupProvider(provider);
            spawned = spawnAgentProvider({
              cwd,
              agentId,
              persistSession: true,
            });
            provider = spawned.provider;
            return provider;
          },
        });
        provider = inited.provider;
        session = inited.session;
      }
      const remoteSessionId = session.sessionId;
      if (!remoteSessionId) {
        throw new BridgeError(
          "session_init_failed",
          `${spawned.agentId} ACP initSession did not return a sessionId`,
          502,
        );
      }
      let entry: SessionEntry | null = null;
      let pendingConfigOptions: unknown = null;
      installClientHandlers(provider, approvals, cwd, remoteSessionId, (options) => {
        if (entry) this.#applyConfigOptions(entry, options);
        else pendingConfigOptions = options;
      });
      let info = infoFromRow(row);
      // Refresh mode/model catalogs from live ACP (configOptions / legacy).
      const normalized = this.#compatCatalog(
        agentId,
        normalizeAcpSessionConfig(session),
      );
      if (normalized.modes) info.modes = normalized.modes;
      if (normalized.models) info.models = normalized.models;
      if (normalized.thoughtLevels) info.thoughtLevels = normalized.thoughtLevels;
      if (normalized.fastOptions) info.fastOptions = normalized.fastOptions;
      if (normalized.contextOptions) info.contextOptions = normalized.contextOptions;
      if (normalized.thinkingOptions) info.thinkingOptions = normalized.thinkingOptions;
      if (normalized.modelConfigById) {
        info.modelConfigById = {
          ...info.modelConfigById,
          ...normalized.modelConfigById,
        };
      }
      info = applyInfoCatalog(info);
      this.#rememberCatalog(agentId, cwd, {
        modes: info.modes,
        models: info.models,
        thoughtLevels: info.thoughtLevels,
        fastOptions: info.fastOptions,
        contextOptions: info.contextOptions,
        thinkingOptions: info.thinkingOptions,
        modelConfigById: info.modelConfigById,
      });
      this.#persistInfo(info);
      this.#db.updateRemoteSession(sessionId, remoteSessionId, compat.resume);
      entry = {
        info,
        remoteSessionId,
        resumeBehavior: compat.resume,
        provider,
        approvals,
      };
      this.#sessions.set(sessionId, entry);
      if (pendingConfigOptions) {
        this.#applyConfigOptions(entry, pendingConfigOptions);
      }
      await this.#ensureSessionCatalog(entry);
      this.#rememberModelConfig(sessionId, sessionInfoToConfigDto(entry.info));
      return entry;
    } catch (err) {
      const authMethods = readProviderAuthMethods(provider);
      try {
        provider.cleanup();
      } catch {
        /* ignore */
      }
      throw classifySessionInitError(err, spawned.agentId, { authMethods });
    }
  }

  getMessages(
    sessionId: string,
    options?: GetMessagesOptions,
  ): UIMessage[] {
    // Existence check (DB or memory).
    this.getInfo(sessionId);
    return this.#db.getMessages(sessionId, options);
  }

  /** Session mode/model config for the frontend SessionConfigBar. */
  async getConfig(sessionId: string): Promise<SessionConfigDto> {
    const entry = await this.ensureOpen(sessionId);
    entry.info = applyInfoCatalog(entry.info);
    if (hasFullCatalog(entry.info)) {
      return sessionInfoToConfigDto(entry.info);
    }
    return this.#withSessionOp(sessionId, "get-config", async (signal) => {
      const live = await this.ensureOpen(sessionId);
      await rejectWhenAborted(signal, this.#ensureSessionCatalog(live));
      live.info = applyInfoCatalog(live.info);
      return sessionInfoToConfigDto(live.info);
    });
  }

  async setMode(sessionId: string, modeId: string): Promise<SessionConfigDto> {
    const trimmed = modeId.trim();
    if (!trimmed) {
      throw new BridgeError("invalid_mode", "modeId must be a non-empty string", 400);
    }
    return this.#withSessionOp(sessionId, "set-mode", async (signal) => {
      const entry = await this.ensureOpen(sessionId);
      await rejectWhenAborted(signal, this.#ensureSessionCatalog(entry));
      try {
        await rejectWhenAborted(signal, entry.provider.setMode(trimmed));
      } catch (err) {
        if (err instanceof BridgeError) throw err;
        throw new BridgeError(
          "set_mode_failed",
          errorText(err) || "Failed to set mode",
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
    });
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
    return this.#withSessionOp(sessionId, "set-model", async (signal) => {
      const entry = await this.ensureOpen(sessionId);
      return this.#setModelUnlocked(entry, trimmed, signal);
    });
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<SessionConfigDto> {
    const trimmedConfigId = configId.trim();
    const trimmedValue = value.trim();
    if (!trimmedConfigId || !trimmedValue) {
      throw new BridgeError(
        "invalid_config_option",
        "configId and value must be non-empty strings",
        400,
      );
    }
    return this.#withSessionOp(sessionId, "set-config-option", async (signal) => {
      const entry = await this.ensureOpen(sessionId);
      const response = await rejectWhenAborted(
        signal,
        setSessionConfigOption(entry.provider, {
          sessionId: entry.remoteSessionId,
          configId: trimmedConfigId,
          value: trimmedValue,
        }),
      );
      if (response === undefined) {
        if (trimmedConfigId === MODE_THOUGHT_CONFIG_ID) {
          try {
            await rejectWhenAborted(
              signal,
              entry.provider.setMode(trimmedValue),
            );
          } catch (err) {
            if (err instanceof BridgeError) throw err;
            throw new BridgeError(
              "set_mode_failed",
              errorText(err) || "Failed to set mode",
              502,
            );
          }
          if (entry.info.thoughtLevels?.configId === MODE_THOUGHT_CONFIG_ID) {
            entry.info.thoughtLevels.currentId = trimmedValue;
          }
          if (
            entry.info.modes?.availableModes?.some(
              (mode) => mode.id === trimmedValue,
            )
          ) {
            entry.info.modes = {
              ...entry.info.modes,
              currentModeId: trimmedValue,
            };
          }
        } else {
          throw new BridgeError(
            "config_option_unsupported",
            `${entry.info.agent} does not support session configuration options`,
            409,
          );
        }
      } else if (Array.isArray(response.configOptions)) {
        this.#applyConfigOptions(entry, response.configOptions);
      } else if (entry.info.thoughtLevels?.configId === trimmedConfigId) {
        entry.info.thoughtLevels.currentId = trimmedValue;
      } else if (entry.info.fastOptions?.configId === trimmedConfigId) {
        entry.info.fastOptions.currentId = trimmedValue;
      } else if (entry.info.contextOptions?.configId === trimmedConfigId) {
        entry.info.contextOptions.currentId = trimmedValue;
      } else if (entry.info.thinkingOptions?.configId === trimmedConfigId) {
        entry.info.thinkingOptions.currentId = trimmedValue;
      }
      entry.info.updatedAt = new Date().toISOString();
      this.#persistInfo(entry.info);
      const dto = sessionInfoToConfigDto(entry.info);
      this.#rememberModelConfig(sessionId, dto);
      return dto;
    });
  }

  /**
   * Config snapshot for one model. Bridge chooses advertised / cache /
   * same-session serial probe (no throwaway ACP session).
   */
  async getModelConfig(
    sessionId: string,
    modelId: string,
  ): Promise<SessionConfigDto & { modelId: string }> {
    const trimmed = modelId.trim();
    if (!trimmed) {
      throw new BridgeError(
        "invalid_model",
        "modelId must be a non-empty string",
        400,
      );
    }
    return this.#withSessionOp(sessionId, "probe-model-config", async (signal) => {
      return this.#getModelConfigUnlocked(sessionId, trimmed, signal);
    });
  }

  /** Compat wrapper: old POST probe path. */
  async probeModelConfig(
    sessionId: string,
    modelId: string,
  ): Promise<SessionConfigDto & { modelId: string }> {
    return this.getModelConfig(sessionId, modelId);
  }

  async probeModelsConfig(
    sessionId: string,
    modelIds: string[],
  ): Promise<Array<SessionConfigDto & { modelId: string }>> {
    const ids = modelIds
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (ids.length === 0) {
      throw new BridgeError(
        "invalid_models",
        "Request body must include at least one modelId",
        400,
      );
    }
    return this.#withSessionOp(sessionId, "probe-model-config", async (signal) => {
      const entry = await this.ensureOpen(sessionId);
      const originalModelId = entry.info.models?.currentModelId ?? null;
      const probes: Array<SessionConfigDto & { modelId: string }> = [];
      try {
        for (const modelId of ids) {
          const dto = await this.#setModelUnlocked(entry, modelId, signal);
          probes.push({ ...dto, modelId });
        }
      } finally {
        await this.#restoreModelAfterProbe(entry, originalModelId, signal);
      }
      return probes;
    });
  }

  async #getModelConfigUnlocked(
    sessionId: string,
    modelId: string,
    signal: AbortSignal,
  ): Promise<SessionConfigDto & { modelId: string }> {
    const entry = await this.ensureOpen(sessionId);
    await rejectWhenAborted(signal, this.#ensureSessionCatalog(entry));
    const currentModelId = entry.info.models?.currentModelId ?? null;
    const live = sessionInfoToConfigDto(entry.info);
    const liveHasThoughtOrFast =
      live.thoughtLevels.length > 0 ||
      live.fastOptions.length > 0 ||
      live.contextOptions.length > 0 ||
      live.thinkingOptions.length > 0;
    const discovery = resolveAgentCompat(entry.info.agent).configDiscovery;
    const advertisedAxes = entry.info.modelConfigById?.[modelId];
    const hasPerModelAdvertisedMap =
      !!entry.info.modelConfigById &&
      Object.keys(entry.info.modelConfigById).length > 0;
    const cached = this.#cachedModelConfig(sessionId, modelId);
    const cachedUsable =
      !!cached &&
      (cached.thoughtLevels.length > 0 ||
        cached.fastOptions.length > 0 ||
        cached.contextOptions.length > 0 ||
        cached.thinkingOptions.length > 0);

    if (currentModelId === modelId) {
      if (liveHasThoughtOrFast || discovery === "advertised") {
        this.#rememberModelConfig(sessionId, live);
        return { ...live, modelId };
      }
      try {
        const probed = await this.#setModelUnlocked(entry, modelId, signal);
        return { ...probed, modelId };
      } catch {
        this.#rememberModelConfig(sessionId, live);
        return { ...live, modelId };
      }
    }

    if (
      shouldSkipModelConfigProbe({
        configDiscovery: discovery,
        currentModelId,
        requestedModelId: modelId,
        hasCachedSnapshot: cachedUsable,
        liveHasThoughtOrFast,
        hasAdvertisedModelSnapshot: !!advertisedAxes,
        hasPerModelAdvertisedMap,
      })
    ) {
      if (advertisedAxes) {
        const overlay = overlayDtoWithModelAxes(live, advertisedAxes, modelId);
        this.#rememberModelConfig(sessionId, overlay);
        return overlay;
      }
      if (cachedUsable && cached) {
        return {
          ...live,
          currentModelId: modelId,
          thoughtLevels: cached.thoughtLevels,
          fastOptions: cached.fastOptions,
          contextOptions: cached.contextOptions,
          thinkingOptions: cached.thinkingOptions,
          thoughtLevelConfigId: cached.thoughtLevelConfigId,
          currentThoughtLevelId: cached.currentThoughtLevelId,
          fastConfigId: cached.fastConfigId,
          currentFastId: cached.currentFastId,
          contextConfigId: cached.contextConfigId,
          currentContextId: cached.currentContextId,
          thinkingConfigId: cached.thinkingConfigId,
          currentThinkingId: cached.currentThinkingId,
          modelId,
        };
      }
      return { ...live, currentModelId: modelId, modelId };
    }

    const originalModelId = currentModelId;
    try {
      const probed = await this.#setModelUnlocked(entry, modelId, signal);
      this.#rememberModelConfig(sessionId, { ...probed, currentModelId: modelId });
      return { ...probed, currentModelId: modelId, modelId };
    } finally {
      await this.#restoreModelAfterProbe(entry, originalModelId, signal);
    }
  }

  async #setModelUnlocked(
    entry: SessionEntry,
    modelId: string,
    signal: AbortSignal,
  ): Promise<SessionConfigDto> {
    await rejectWhenAborted(signal, this.#ensureSessionCatalog(entry));
    // Prefer session/set_config_option: OpenCode (and ACP v2) return the full
    // configOptions snapshot, including per-model thought_level. Legacy
    // session/set_model does not.
    const viaConfigOption = await this.#trySetModelViaConfigOption(
      entry,
      modelId,
      signal,
    );
    if (!viaConfigOption) {
      try {
        const result: unknown = await rejectWhenAborted(
          signal,
          entry.provider.setModel(modelId),
        );
        if (
          result &&
          typeof result === "object" &&
          Array.isArray((result as { configOptions?: unknown }).configOptions)
        ) {
          this.#applyConfigOptions(
            entry,
            (result as { configOptions: unknown }).configOptions,
          );
        }
      } catch (err) {
        if (err instanceof BridgeError) throw err;
        const classified = resolveAgentCompat(entry.info.agent).classifyError?.(
          err,
          "config",
        );
        if (classified) {
          throw new BridgeError(
            classified.code,
            classified.message,
            classified.status,
            classified.details,
          );
        }
        throw new BridgeError(
          "set_model_failed",
          errorText(err) || "Failed to set model",
          502,
        );
      }
    }
    const models = {
      currentModelId: modelId,
      availableModels: entry.info.models?.availableModels ?? [],
    };
    entry.info = {
      ...entry.info,
      models,
      updatedAt: new Date().toISOString(),
    };
    this.#persistInfo(entry.info);
    const dto = sessionInfoToConfigDto(entry.info);
    this.#rememberModelConfig(entry.info.sessionId, dto);
    return dto;
  }

  #applyConfigOptions(entry: SessionEntry, configOptions: unknown): void {
    const normalized = this.#compatCatalog(
      entry.info.agent,
      normalizeAcpSessionConfig({ configOptions }),
    );
    if (normalized.modes) entry.info.modes = normalized.modes;
    if (normalized.models) entry.info.models = normalized.models;
    const catalogRefresh = Boolean(normalized.models || normalized.modes);
    const discovery = resolveAgentCompat(entry.info.agent).configDiscovery;
    // Per-model thought must not linger across a catalog refresh that omitted
    // it. Advertised session-level thought must be kept — wiping it would
    // force a later probe that advertised agents should never need.
    if (normalized.thoughtLevels) {
      entry.info.thoughtLevels = normalized.thoughtLevels;
    } else if (
      catalogRefresh &&
      discovery === "per-model-probe-fallback"
    ) {
      entry.info.thoughtLevels = undefined;
    }
    if (normalized.fastOptions) {
      entry.info.fastOptions = normalized.fastOptions;
    } else if (
      catalogRefresh &&
      discovery === "per-model-probe-fallback"
    ) {
      entry.info.fastOptions = undefined;
    }
    if (normalized.contextOptions) {
      entry.info.contextOptions = normalized.contextOptions;
    } else if (
      catalogRefresh &&
      discovery === "per-model-probe-fallback"
    ) {
      entry.info.contextOptions = undefined;
    }
    if (normalized.thinkingOptions) {
      entry.info.thinkingOptions = normalized.thinkingOptions;
    } else if (
      catalogRefresh &&
      discovery === "per-model-probe-fallback"
    ) {
      entry.info.thinkingOptions = undefined;
    }
    if (normalized.modelConfigById) {
      entry.info.modelConfigById = {
        ...entry.info.modelConfigById,
        ...normalized.modelConfigById,
      };
    }
    entry.info.updatedAt = new Date().toISOString();
    this.#rememberCatalog(entry.info.agent, entry.info.cwd, normalized);
    this.#persistInfo(entry.info);
    this.#rememberModelConfig(entry.info.sessionId, sessionInfoToConfigDto(entry.info));
  }

  #compatCatalog(
    agentId: string,
    normalized: NormalizedAcpSessionConfig,
  ): NormalizedAcpSessionConfig {
    return applyCompatCatalog(agentId, normalized);
  }

  async #trySetModelViaConfigOption(
    entry: SessionEntry,
    modelId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      const response = await rejectWhenAborted(
        signal,
        setSessionConfigOption(entry.provider, {
          sessionId: entry.remoteSessionId,
          configId: "model",
          value: modelId,
        }),
      );
      if (response === undefined) return false;
      if (Array.isArray(response.configOptions)) {
        this.#applyConfigOptions(entry, response.configOptions);
      }
      return true;
    } catch (err) {
      if (err instanceof BridgeError && err.code === "request_aborted") {
        throw err;
      }
      return false;
    }
  }

  async #restoreModelAfterProbe(
    entry: SessionEntry,
    originalModelId: string | null,
    signal: AbortSignal,
  ): Promise<void> {
    const original = originalModelId?.trim() ?? "";
    if (!original) return;
    if (entry.info.models?.currentModelId === original) return;
    try {
      await this.#setModelUnlocked(entry, original, signal);
      return;
    } catch {
      const outcome = await restoreProbedModel({
        originalModelId: original,
        currentModelId: entry.info.models?.currentModelId,
        restore: (modelId) => entry.provider.setModel(modelId),
      });
      if (outcome === "skipped" || !entry.info.models) return;
      entry.info = {
        ...entry.info,
        models: { ...entry.info.models, currentModelId: original },
        updatedAt: new Date().toISOString(),
      };
      this.#persistInfo(entry.info);
    }
  }

  #rememberCatalog(
    agentId: string,
    cwd: string,
    normalized: NormalizedAcpSessionConfig,
  ): void {
    this.#catalog.remember(agentId, cwd, normalized);
  }

  #rememberModelConfig(sessionId: string, dto: SessionConfigDto): void {
    const modelId = dto.currentModelId;
    if (!modelId) return;
    let byModel = this.#modelConfigBySession.get(sessionId);
    if (!byModel) {
      byModel = new Map();
      this.#modelConfigBySession.set(sessionId, byModel);
    }
    byModel.set(modelId, dto);
  }

  #cachedModelConfig(
    sessionId: string,
    modelId: string,
  ): SessionConfigDto | undefined {
    return this.#modelConfigBySession.get(sessionId)?.get(modelId);
  }

  /**
   * When loadSession omits catalogs, fill from agent+cwd cache, a live
   * session's session/new advertisement, or a throwaway session/new probe.
   */
  async #ensureSessionCatalog(entry: SessionEntry): Promise<void> {
    entry.info = applyInfoCatalog(entry.info);
    const discovery = resolveAgentCompat(entry.info.agent).configDiscovery;
    const hasModes = (entry.info.modes?.availableModes?.length ?? 0) > 0;
    const hasModels = (entry.info.models?.availableModels?.length ?? 0) > 0;
    if (hasModes && hasModels) {
      let changed = false;
      if (discovery === "advertised") {
        const cached = this.#catalog.get(entry.info.agent, entry.info.cwd);
        if (!entry.info.thoughtLevels && cached?.thoughtLevels) {
          entry.info = {
            ...entry.info,
            thoughtLevels: cached.thoughtLevels,
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
        if (!entry.info.fastOptions && cached?.fastOptions) {
          entry.info = {
            ...entry.info,
            fastOptions: cached.fastOptions,
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
        if (!entry.info.contextOptions && cached?.contextOptions) {
          entry.info = {
            ...entry.info,
            contextOptions: cached.contextOptions,
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
        if (!entry.info.thinkingOptions && cached?.thinkingOptions) {
          entry.info = {
            ...entry.info,
            thinkingOptions: cached.thinkingOptions,
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
        if (!entry.info.modelConfigById && cached?.modelConfigById) {
          entry.info = {
            ...entry.info,
            modelConfigById: cached.modelConfigById,
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
      }
      this.#rememberCatalog(entry.info.agent, entry.info.cwd, {
        modes: entry.info.modes,
        models: entry.info.models,
        thoughtLevels: entry.info.thoughtLevels,
        fastOptions: entry.info.fastOptions,
        contextOptions: entry.info.contextOptions,
        thinkingOptions: entry.info.thinkingOptions,
        modelConfigById: entry.info.modelConfigById,
      });
      if (changed) this.#persistInfo(entry.info);
      return;
    }

    let catalog = this.#catalog.get(entry.info.agent, entry.info.cwd);
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
    if (
      discovery === "advertised" &&
      !entry.info.thoughtLevels &&
      catalog.thoughtLevels
    ) {
      entry.info.thoughtLevels = catalog.thoughtLevels;
      changed = true;
    }
    if (
      discovery === "advertised" &&
      !entry.info.fastOptions &&
      catalog.fastOptions
    ) {
      entry.info.fastOptions = catalog.fastOptions;
      changed = true;
    }
    if (
      discovery === "advertised" &&
      !entry.info.contextOptions &&
      catalog.contextOptions
    ) {
      entry.info.contextOptions = catalog.contextOptions;
      changed = true;
    }
    if (
      discovery === "advertised" &&
      !entry.info.thinkingOptions &&
      catalog.thinkingOptions
    ) {
      entry.info.thinkingOptions = catalog.thinkingOptions;
      changed = true;
    }
    if (!entry.info.modelConfigById && catalog.modelConfigById) {
      entry.info.modelConfigById = catalog.modelConfigById;
      changed = true;
    }
    if (changed) {
      entry.info = applyInfoCatalog({
        ...entry.info,
        updatedAt: new Date().toISOString(),
      });
      this.#persistInfo(entry.info);
    }
  }

  async #probeCatalog(
    cwd: string,
    agentId = "opencode",
  ): Promise<NormalizedAcpSessionConfig> {
    const key = catalogCacheKey(agentId, cwd);
    const pending = this.#catalogProbe.get(key);
    if (pending) return pending;

    const promise = (async (): Promise<NormalizedAcpSessionConfig> => {
      const live = liveCatalogForProbe(this.#sessions.values(), agentId, cwd);
      if (live) {
        this.#rememberCatalog(agentId, cwd, live);
        return live;
      }
      const spawned = spawnAgentProvider({
        cwd,
        agentId,
        persistSession: false,
      });
      const { provider } = spawned;
      try {
        const session = await initProviderSession(provider);
        const normalized = this.#compatCatalog(
          agentId,
          normalizeAcpSessionConfig(session),
        );
        this.#rememberCatalog(agentId, cwd, normalized);
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
    const live = this.#sessions.get(info.sessionId);
    this.#db.upsertSession({
      sessionId: info.sessionId,
      agent: info.agent,
      cwd: info.cwd,
      title: info.title ?? null,
      createdAt: info.createdAt,
      updatedAt: info.updatedAt ?? new Date().toISOString(),
      ...catalogPersistFields(info),
      remoteSessionId: live?.remoteSessionId,
      resumeBehavior: live?.resumeBehavior,
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
    if (live) {
      live.info = {
        ...next,
        thoughtLevels: next.thoughtLevels ?? live.info.thoughtLevels,
        fastOptions: next.fastOptions ?? live.info.fastOptions,
        contextOptions: next.contextOptions ?? live.info.contextOptions,
        thinkingOptions: next.thinkingOptions ?? live.info.thinkingOptions,
        modelConfigById: next.modelConfigById ?? live.info.modelConfigById,
      };
      return live.info;
    }
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
    this.#modelConfigBySession.delete(sessionId);
    this.#db.deleteSession(sessionId);
  }

  /**
   * Drop the live ACP process and keep SQLite. Idempotent when already cold.
   * Chat / getConfig / ensureOpen reopen via the existing session/load path.
   */
  hibernate(sessionId: string): SessionInfo {
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
    this.#modelConfigBySession.delete(sessionId);
    return this.getInfo(sessionId);
  }

  /**
   * Tear down live ACP processes; keep SQLite (Bridge restart / graceful stop).
   */
  dispose(): void {
    for (const id of [...this.#sessions.keys()]) {
      const entry = this.#sessions.get(id);
      this.#sessions.delete(id);
      this.#modelConfigBySession.delete(id);
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
