/**
 * Bun Bridge / AI SDK session client (M1+).
 * Host-aware REST against `/api/sessions` and `/health`.
 */
import type { QenexHost } from "@qenex/platform";
import {
  agentNameFromUnknown,
  authMethodsFromUnknown,
  errorCodeOf,
  getBridgeHost,
  isAuthRequiredCode,
  looksLikeAuthMessage,
  stringifyErrorMessage,
  type AuthMethodInfo,
  type AuthRequiredPayload,
} from "./bridge-client.ts";
import {
  EMPTY_SESSION_CONFIG,
  parseSessionOptions,
  splitThinkingToggleFromCachedOptions,
  type AuthChallenge,
  type SessionConfig,
} from "./session-config.ts";

/** Minimal UIMessage shape for Bridge history (avoid coupling core to `ai` package). */
export type AisdkUIMessage = {
  id: string;
  role: string;
  parts: unknown[];
  metadata?: unknown;
};

export type AisdkSessionInfo = {
  sessionId: string;
  agent: string;
  cwd: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string | null;
  modes?: {
    currentModeId?: string;
    availableModes?: Array<{ id: string; name?: string }>;
  };
  models?: {
    currentModelId?: string;
    availableModels?: Array<{ modelId: string; name?: string }>;
  };
};

/** Bridge GET /api/sessions/:id/config body (M5). */
export type AisdkSessionConfigResponse = {
  sessionId?: string;
  modes?: unknown;
  models?: unknown;
  currentModeId?: string | null;
  currentModelId?: string | null;
  thoughtLevels?: unknown;
  fastOptions?: unknown;
  contextOptions?: unknown;
  thinkingOptions?: unknown;
  thoughtLevelConfigId?: string | null;
  currentThoughtLevelId?: string | null;
  fastConfigId?: string | null;
  currentFastId?: string | null;
  contextConfigId?: string | null;
  currentContextId?: string | null;
  thinkingConfigId?: string | null;
  currentThinkingId?: string | null;
  modelConfigs?: Record<string, {
    thoughtLevels?: unknown;
    fastOptions?: unknown;
    contextOptions?: unknown;
    thinkingOptions?: unknown;
    thoughtLevelConfigId?: string | null;
    currentThoughtLevelId?: string | null;
    fastConfigId?: string | null;
    currentFastId?: string | null;
    contextConfigId?: string | null;
    currentContextId?: string | null;
    thinkingConfigId?: string | null;
    currentThinkingId?: string | null;
  }>;
  nativeResume?: boolean;
};

/** Bun Bridge chat / permission mode (Phase 3 / M2). */
export type ApprovalMode = "ask" | "auto";

export type BridgeApprovalOption = {
  optionId: string;
  name: string;
  kind?: string;
};

export type BridgePermissionToolCall = {
  toolCallId: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  locations?: Array<{ path?: string; line?: number | null }> | null;
};

export type BridgePendingApproval = {
  approvalId: string;
  sessionId: string;
  createdAt: string;
  toolCall: BridgePermissionToolCall;
  options: BridgeApprovalOption[];
};

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "ask" || value === "auto";
}

/** Map fusion「无需审批」pref → Bridge approvalMode. */
export function approvalModeFromAutoAllow(autoAllow: boolean): ApprovalMode {
  return autoAllow ? "auto" : "ask";
}

export type AisdkBridgeErrorBody = {
  error?: {
    code?: string;
    message?: unknown;
    details?: unknown;
  };
};

function detailsOf(err: unknown): unknown {
  if (!err || typeof err !== "object") return undefined;
  const rec = err as { details?: unknown; body?: { details?: unknown } };
  return rec.details ?? rec.body?.details;
}

function withDetail(prefix: string, detail: string, fallback: string): string {
  const text = stringifyErrorMessage(detail);
  if (!text) return fallback;
  return `${prefix}${text}`;
}

function authAgentName(err: unknown, fallback = "Agent"): string {
  return (
    agentNameFromUnknown(detailsOf(err)) ??
    agentNameFromUnknown(err) ??
    fallback
  );
}

export class BridgeClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status = 500,
    details?: unknown,
  ) {
    super(stringifyErrorMessage(message));
    this.name = "BridgeClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  asAuthRequired(): AuthRequiredPayload | null {
    const detail = stringifyErrorMessage(this.message);
    if (!isAuthRequiredCode(this.code) && !looksLikeAuthMessage(detail)) {
      return null;
    }
    return {
      code: isAuthRequiredCode(this.code) ? this.code : "auth_required",
      detail: detail || this.message,
      methods: authMethodsFromUnknown(this.details),
      agentName: agentNameFromUnknown(this.details),
    };
  }
}

export function formatAuthRequiredMessage(
  err: unknown,
  fallbackAgentName = "Agent",
): string {
  const code = errorCodeOf(err);
  if (code === "opencode_auth_required") {
    return "OpenCode 需要登录。请在终端运行 `opencode auth login`（或对应提供商的登录命令）后再试。";
  }
  const name = authAgentName(err, fallbackAgentName);
  return `${name} 需要登录。请完成该 Agent 的登录后重试。`;
}

export function authChallengeFromError(
  err: unknown,
  fallbackAgentName?: string | null,
): AuthChallenge {
  const fromDetails = authMethodsFromUnknown(detailsOf(err));
  const methods: AuthMethodInfo[] =
    fromDetails.length > 0 ? fromDetails : authMethodsFromUnknown(err);
  const agentName =
    fallbackAgentName?.trim() ||
    agentNameFromUnknown(detailsOf(err)) ||
    agentNameFromUnknown(err) ||
    null;
  return {
    detail: formatAuthRequiredMessage(err, agentName ?? "Agent"),
    methods,
    agentName,
  };
}

export function formatBridgeError(
  err: unknown,
  fallback = "操作失败，请重试。",
): string {
  const rawMessage = stringifyErrorMessage(err);

  // Prefer actionable mapping even when AI SDK wraps the upstream text.
  if (
    /insufficient\s*balance|余额不足|quota\s*exceeded|billing|payment.?required/i.test(
      rawMessage,
    )
  ) {
    return "模型服务余额不足（Insufficient Balance）。请在 OpenCode 对应提供商账户充值，或切换已配置且有额度的模型后重试。";
  }

  const code =
    err instanceof BridgeClientError ? err.code : errorCodeOf(err);
  const message =
    err instanceof BridgeClientError
      ? stringifyErrorMessage(err.message) || rawMessage
      : rawMessage;

  if (isAuthRequiredCode(code) || looksLikeAuthMessage(message)) {
    if (
      /需要登录/.test(message) &&
      code !== "auth_required" &&
      code !== "opencode_auth_required"
    ) {
      return message;
    }
    return formatAuthRequiredMessage(err);
  }

  if (err instanceof BridgeClientError || code) {
    switch (code) {
      case "opencode_not_found":
        return "未找到 OpenCode。请先安装 OpenCode，并确保终端里能运行 `opencode --version`（或设置环境变量 QENEX_OPENCODE_BIN）。";
      case "agent_unavailable":
        return withDetail("Agent 不可用：", message, "Agent 不可用。");
      case "agent_spawn_failed":
        return withDetail(
          "启动 Agent ACP 进程失败：",
          message,
          "启动 Agent ACP 进程失败。",
        );
      case "opencode_spawn_failed":
        return "启动 OpenCode ACP 进程失败。请确认 `opencode --version` 可运行，检查权限后重试。";
      case "session_init_failed": {
        const detail = stringifyErrorMessage(message);
        if (/个人 Google 登录已停用|Antigravity/i.test(detail)) {
          return detail;
        }
        return detail
          ? `创建会话失败：${detail}。可检查 Agent 是否已安装并已登录，然后重试。`
          : "创建会话失败。可检查 Agent 是否已安装并已登录，然后重试。";
      }
      case "invalid_cwd":
      case "missing_cwd": {
        const hint =
          message && !/^missing_cwd|invalid_cwd$/i.test(message)
            ? `\n（${message}）`
            : "";
        return `工作区路径无效。请填写本机上存在的项目目录。${hint}`;
      }
      case "session_not_found":
        return "会话已不存在（可能已被删除）。请新建会话。";
      case "permission_bridge_unavailable":
        return "当前 Bridge 无法挂接审批回调。请确认依赖版本后重启 Bridge。";
      case "set_mode_failed":
        return withDetail("切换 Agent 模式失败：", message, "切换 Agent 模式失败。");
      case "set_model_failed":
        return withDetail("切换模型失败：", message, "切换模型失败。");
      case "config_option_unsupported":
        return withDetail(
          "当前 Agent 不支持这项配置：",
          message,
          "当前 Agent 不支持这项配置。",
        );
      case "set_config_option_failed":
        return withDetail("切换配置失败：", message, "切换配置失败。");
      default:
        return message || fallback;
    }
  }
  if (rawMessage && !/^an error occurred\.?$/i.test(rawMessage.trim())) {
    return rawMessage;
  }
  if (typeof err === "string" && err) {
    return stringifyErrorMessage(err) || fallback;
  }
  return fallback;
}

async function bridgeUrl(host: QenexHost, path: string): Promise<string> {
  const base = (await host.getBridgeBaseUrl()).replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Default Bridge REST bound. Session create is longer: ACP authenticate can open a browser. */
const BRIDGE_FETCH_TIMEOUT_MS = 60_000;
/** Must cover session/new + in-process ACP authenticate (default 5 min) + retry. */
export const SESSION_CREATE_TIMEOUT_MS = 8 * 60_000;

function hostFetch(
  host: QenexHost,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return host.fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
  });
}

async function readBridgeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new BridgeClientError(
      "invalid_json",
      `Bridge returned non-JSON (${res.status})`,
      res.status,
    );
  }
}

function throwBridgeError(
  res: Response,
  json: unknown,
  fallback: string,
): never {
  const body = json as AisdkBridgeErrorBody;
  const nested = body.error;
  const code =
    (typeof nested?.code === "string" && nested.code) || "internal_error";
  const message =
    stringifyErrorMessage(nested?.message) ||
    stringifyErrorMessage(nested?.details) ||
    fallback;
  throw new BridgeClientError(code, message, res.status, nested?.details);
}

export async function createAisdkSession(
  cwd: string,
  host: QenexHost = getBridgeHost(),
  options?: { agentId?: string; agentCommand?: string[] },
): Promise<AisdkSessionInfo> {
  const url = await bridgeUrl(host, "/api/sessions");
  const res = await hostFetch(host, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cwd,
      agentId: options?.agentId,
      agentCommand:
        options?.agentCommand && options.agentCommand.length > 0
          ? options.agentCommand
          : undefined,
    }),
    signal: AbortSignal.timeout(SESSION_CREATE_TIMEOUT_MS),
  });
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `createSession failed (${res.status})`);
  }
  return json as AisdkSessionInfo;
}

export async function getAisdkSession(
  sessionId: string,
  host: QenexHost = getBridgeHost(),
): Promise<AisdkSessionInfo | null> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  const res = await hostFetch(host, url);
  if (res.status === 404) return null;
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `getSession failed (${res.status})`);
  }
  return json as AisdkSessionInfo;
}

export async function deleteAisdkSession(
  sessionId: string,
  host: QenexHost = getBridgeHost(),
): Promise<void> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  const res = await hostFetch(host, url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const json = await readBridgeJson(res);
    throwBridgeError(res, json, `deleteSession failed (${res.status})`);
  }
}

export async function listAisdkSessionMessages(
  sessionId: string,
  host: QenexHost = getBridgeHost(),
): Promise<AisdkUIMessage[]> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  const res = await hostFetch(host, url);
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `listSessionMessages failed (${res.status})`);
  }
  const messages = (json as { messages?: AisdkUIMessage[] }).messages;
  return Array.isArray(messages) ? messages : [];
}

export async function updateAisdkSessionTitle(
  sessionId: string,
  title: string,
  host: QenexHost = getBridgeHost(),
): Promise<AisdkSessionInfo> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  const res = await hostFetch(host, url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `updateSessionTitle failed (${res.status})`);
  }
  return json as AisdkSessionInfo;
}

export function toAisdkSessionConfig(
  payload: AisdkSessionConfigResponse,
): SessionConfig {
  const modes = parseSessionOptions(payload.modes);
  const models = parseSessionOptions(payload.models);
  const thoughtLevels = parseSessionOptions(payload.thoughtLevels);
  const fastOptions = parseSessionOptions(payload.fastOptions);
  const contextOptions = parseSessionOptions(payload.contextOptions);
  const thinkingOptions = parseSessionOptions(payload.thinkingOptions);
  const liveSplit = splitThinkingToggleFromCachedOptions({
    thoughtLevels,
    thinkingOptions,
    currentThoughtLevelId: payload.currentThoughtLevelId ?? null,
    currentThinkingId: payload.currentThinkingId ?? null,
  });
  const modelConfigs = payload.modelConfigs
    ? Object.fromEntries(
        Object.entries(payload.modelConfigs).map(([modelId, axes]) => {
          const rawThinking = parseSessionOptions(axes?.thinkingOptions);
          const split = splitThinkingToggleFromCachedOptions({
            thoughtLevels: parseSessionOptions(axes?.thoughtLevels),
            thinkingOptions: rawThinking,
            currentThoughtLevelId: axes?.currentThoughtLevelId ?? null,
            currentThinkingId: axes?.currentThinkingId ?? null,
          });
          return [
            modelId,
            {
              thoughtLevels: split.thoughtLevels,
              fastOptions: parseSessionOptions(axes?.fastOptions),
              contextOptions: parseSessionOptions(axes?.contextOptions),
              thinkingOptions: split.thinkingOptions,
              thoughtLevelConfigId: axes?.thoughtLevelConfigId ?? null,
              currentThoughtLevelId: split.currentThoughtLevelId,
              fastConfigId: axes?.fastConfigId ?? null,
              currentFastId: axes?.currentFastId ?? null,
              contextConfigId: axes?.contextConfigId ?? null,
              currentContextId: axes?.currentContextId ?? null,
              thinkingConfigId:
                axes?.thinkingConfigId ??
                (rawThinking.length === 0 && split.thinkingOptions.length > 0
                  ? (axes?.thoughtLevelConfigId ?? null)
                  : null),
              currentThinkingId: split.currentThinkingId,
            },
          ];
        }),
      )
    : undefined;
  return {
    ...EMPTY_SESSION_CONFIG,
    modes,
    models,
    thoughtLevels: liveSplit.thoughtLevels,
    fastOptions,
    contextOptions,
    thinkingOptions: liveSplit.thinkingOptions,
    currentModeId: payload.currentModeId ?? modes[0]?.id ?? null,
    currentModelId: payload.currentModelId ?? models[0]?.id ?? null,
    currentThoughtLevelId:
      liveSplit.currentThoughtLevelId ?? liveSplit.thoughtLevels[0]?.id ?? null,
    thoughtLevelConfigId: payload.thoughtLevelConfigId ?? null,
    currentFastId: payload.currentFastId ?? fastOptions[0]?.id ?? null,
    fastConfigId: payload.fastConfigId ?? null,
    currentContextId: payload.currentContextId ?? contextOptions[0]?.id ?? null,
    contextConfigId: payload.contextConfigId ?? null,
    currentThinkingId:
      liveSplit.currentThinkingId ?? liveSplit.thinkingOptions[0]?.id ?? null,
    thinkingConfigId:
      payload.thinkingConfigId ??
      (thinkingOptions.length === 0 && liveSplit.thinkingOptions.length > 0
        ? (payload.thoughtLevelConfigId ?? null)
        : null),
    ...(modelConfigs ? { modelConfigs } : {}),
    ready: true,
    loading: false,
    error: null,
    authChallenge: null,
    ...(typeof payload.nativeResume === "boolean"
      ? { nativeResume: payload.nativeResume }
      : {}),
  };
}

export async function getAisdkSessionConfig(
  sessionId: string,
  host: QenexHost = getBridgeHost(),
): Promise<SessionConfig> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/config`,
  );
  const res = await hostFetch(host, url);
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `getSessionConfig failed (${res.status})`);
  }
  return toAisdkSessionConfig(json as AisdkSessionConfigResponse);
}

export async function setAisdkSessionMode(
  sessionId: string,
  modeId: string,
  host: QenexHost = getBridgeHost(),
): Promise<SessionConfig> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/mode`,
  );
  const res = await hostFetch(host, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modeId }),
  });
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `setSessionMode failed (${res.status})`);
  }
  return toAisdkSessionConfig(json as AisdkSessionConfigResponse);
}

export async function setAisdkSessionModel(
  sessionId: string,
  modelId: string,
  host: QenexHost = getBridgeHost(),
): Promise<SessionConfig> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/model`,
  );
  const res = await hostFetch(host, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId }),
  });
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `setSessionModel failed (${res.status})`);
  }
  return toAisdkSessionConfig(json as AisdkSessionConfigResponse);
}

export async function setAisdkSessionConfigOption(
  sessionId: string,
  configId: string,
  value: string,
  host: QenexHost = getBridgeHost(),
): Promise<SessionConfig> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/config-option`,
  );
  const res = await hostFetch(host, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ configId, value }),
  });
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `setSessionConfigOption failed (${res.status})`);
  }
  return toAisdkSessionConfig(json as AisdkSessionConfigResponse);
}

/** GET /api/sessions/:id/models/:modelId/config — SessionConfigDto & { modelId }. */
export type AisdkModelConfig = SessionConfig & { modelId: string };

/** @deprecated Use AisdkModelConfig / getAisdkSessionModelConfig. */
export type AisdkModelConfigProbe = AisdkModelConfig;

function toAisdkModelConfig(
  payload: AisdkSessionConfigResponse & { modelId?: string },
  fallbackModelId: string,
): AisdkModelConfig {
  return {
    ...toAisdkSessionConfig(payload),
    modelId: payload.modelId ?? fallbackModelId,
  };
}

/** Prefetch thought/fast (and the rest of the snapshot) for a model without setModel. */
export async function getAisdkSessionModelConfig(
  sessionId: string,
  modelId: string,
  host: QenexHost = getBridgeHost(),
): Promise<AisdkModelConfig> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/models/${encodeURIComponent(modelId)}/config`,
  );
  const res = await hostFetch(host, url);
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `getSessionModelConfig failed (${res.status})`);
  }
  return toAisdkModelConfig(
    json as AisdkSessionConfigResponse & { modelId?: string },
    modelId,
  );
}

/** @deprecated Use getAisdkSessionModelConfig (GET .../models/:modelId/config). */
export async function probeAisdkSessionModelConfig(
  sessionId: string,
  modelId: string,
  host: QenexHost = getBridgeHost(),
): Promise<AisdkModelConfigProbe> {
  return getAisdkSessionModelConfig(sessionId, modelId, host);
}

/**
 * @deprecated UI should call getAisdkSessionModelConfig per model (Bridge serializes).
 */
export async function probeAisdkSessionModelsConfig(
  sessionId: string,
  modelIds: string[],
  host: QenexHost = getBridgeHost(),
): Promise<AisdkModelConfigProbe[]> {
  const results: AisdkModelConfigProbe[] = [];
  for (const id of modelIds) {
    results.push(await getAisdkSessionModelConfig(sessionId, id, host));
  }
  return results;
}

export async function listPendingApprovals(
  sessionId: string,
  host: QenexHost = getBridgeHost(),
): Promise<BridgePendingApproval[]> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/approvals`,
  );
  const res = await hostFetch(host, url);
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `listPendingApprovals failed (${res.status})`);
  }
  const approvals = (json as { approvals?: BridgePendingApproval[] }).approvals;
  return Array.isArray(approvals) ? approvals : [];
}

export async function respondToApproval(
  sessionId: string,
  approvalId: string,
  optionId: string,
  host: QenexHost = getBridgeHost(),
): Promise<void> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
  );
  const res = await hostFetch(host, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ optionId }),
  });
  if (!res.ok) {
    const json = await readBridgeJson(res);
    throwBridgeError(res, json, `respondToApproval failed (${res.status})`);
  }
}

export async function aisdkHealthCheck(
  host: QenexHost = getBridgeHost(),
): Promise<{ ok: boolean; opencode: string | null }> {
  const url = await bridgeUrl(host, "/health");
  const res = await hostFetch(host, url);
  if (!res.ok) {
    throw new BridgeClientError(
      "health_failed",
      `Health check failed (${res.status})`,
      res.status,
    );
  }
  const json = (await readBridgeJson(res)) as {
    ok?: boolean;
    opencode?: string | null;
  };
  return {
    ok: json.ok === true,
    opencode: json.opencode ?? null,
  };
}

/** Bridge session ids: OpenCode `ses_…`, other ACP agents may use uuid/slugs. */
export function isAisdkSessionId(id: string | undefined | null): boolean {
  if (typeof id !== "string" || !id.trim()) return false;
  // Tab placeholders before Bridge bind.
  if (id.startsWith("pending:") || id.startsWith("local:")) return false;
  return true;
}

/** Dedupe key for Strict Mode / remount: one create per tab+cwd+agent. */
export function sessionBootKey(
  tabId: string,
  cwd: string,
  agentId = "opencode",
): string {
  return `${tabId}::${cwd}::${agentId}`;
}

type SessionBootEntry = {
  promise: Promise<AisdkSessionInfo>;
};

const sessionBootCache = new Map<string, SessionBootEntry>();

/**
 * Create-or-reuse Bridge session for a tab.
 * Concurrent callers (React Strict Mode double-effect) share one POST /api/sessions.
 */
export function ensureAisdkSession(
  tabId: string,
  cwd: string,
  host: QenexHost = getBridgeHost(),
  options?: { agentId?: string; agentCommand?: string[] },
): Promise<AisdkSessionInfo> {
  const agentId = options?.agentId ?? "opencode";
  const key = sessionBootKey(tabId, cwd, agentId);
  const hit = sessionBootCache.get(key);
  if (hit) return hit.promise;

  const promise = createAisdkSession(cwd, host, {
    agentId,
    agentCommand: options?.agentCommand,
  }).catch((err) => {
    sessionBootCache.delete(key);
    throw err;
  });
  sessionBootCache.set(key, { promise });
  return promise;
}

/** Drop cached create promise (retry, tab delete, or cwd change). */
export function invalidateSessionBoot(
  tabId: string,
  cwd: string,
  agentId = "opencode",
): void {
  sessionBootCache.delete(sessionBootKey(tabId, cwd, agentId));
}

/** Test helper / full reset. */
export function clearSessionBootCache(): void {
  sessionBootCache.clear();
}
