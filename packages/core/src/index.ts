export type QenexHostKind = "web" | "desktop" | "vscode" | "jetbrains";

/**
 * Thin platform host. UI must not import Tauri / VS Code / JetBrains APIs.
 */
export type QenexHost = {
  kind: QenexHostKind;
  getBridgeBaseUrl(): string | Promise<string>;
  fetch: typeof fetch;
  storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
  /** Optional native directory picker. Web may omit and use a text field. */
  pickWorkspace?(): Promise<string | null>;
};

export type SessionInfo = {
  sessionId: string;
  agent: string;
  cwd: string;
  createdAt?: string;
};

export type BridgeErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApprovalMode = "ask" | "auto";

export type ApprovalOption = {
  optionId: string;
  name: string;
  kind?: string;
};

export type PendingApproval = {
  approvalId: string;
  sessionId: string;
  createdAt: string;
  toolCall: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    status?: string | null;
    rawInput?: unknown;
    locations?: Array<{ path?: string; line?: number | null }> | null;
  };
  options: ApprovalOption[];
};

/** Read-only ACP artifacts attached via UIMessage.metadata. */
export type PlanEntry = {
  content: string;
  priority?: string;
  status?: string;
};

export type DiffMeta = {
  type?: "diff";
  path: string;
  oldText?: string | null;
  newText: string;
  toolCallId?: string;
};

export type TerminalMeta = {
  type?: "terminal";
  terminalId: string;
  toolCallId?: string;
};

export type QenexMessageMetadata = {
  plan?: PlanEntry[];
  diffs?: DiffMeta[];
  terminals?: TerminalMeta[];
};

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
    super(message);
    this.name = "BridgeClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * User-facing guidance for common Bridge failures.
 * Keep in sync with Bridge error codes.
 */
export function formatBridgeError(
  err: unknown,
  fallback = "操作失败，请重试。",
): string {
  if (err instanceof BridgeClientError) {
    switch (err.code) {
      case "opencode_not_found":
        return "未找到 OpenCode。请先安装 OpenCode，并确保终端里能运行 `opencode --version`（或设置环境变量 QENEX_OPENCODE_BIN）。";
      case "opencode_auth_required":
        return "OpenCode 需要登录。请在终端运行 `opencode auth login`（或对应提供商的登录命令）后再试。";
      case "opencode_spawn_failed":
        return "启动 OpenCode ACP 进程失败。请确认 `opencode --version` 可运行，检查权限后重试。";
      case "session_init_failed":
        return `创建会话失败：${err.message}。可检查 OpenCode 是否已安装并已登录，然后重试。`;
      case "invalid_cwd":
      case "missing_cwd":
        return "工作区路径无效。请填写本机上存在的项目目录。";
      case "session_not_found":
        return "会话已不存在（可能已被删除）。请新建会话。";
      case "permission_bridge_unavailable":
        return "当前 Bridge 无法挂接审批回调。请确认依赖版本后重启 Bridge。";
      default:
        return err.message || fallback;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

const PREF_CWD = "qenex:last-cwd";
const PREF_THEME = "qenex:theme";
const PREF_APPROVAL_MODE = "qenex:approval-mode";

export function loadLastCwd(host: QenexHost): string {
  return host.storage.get(PREF_CWD) ?? "";
}

export function saveLastCwd(host: QenexHost, cwd: string): void {
  host.storage.set(PREF_CWD, cwd);
}

export function loadTheme(host: QenexHost): "light" | "dark" | "system" {
  const v = host.storage.get(PREF_THEME);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function saveTheme(
  host: QenexHost,
  theme: "light" | "dark" | "system",
): void {
  host.storage.set(PREF_THEME, theme);
}

export function loadApprovalMode(host: QenexHost): ApprovalMode {
  return host.storage.get(PREF_APPROVAL_MODE) === "auto" ? "auto" : "ask";
}

export function saveApprovalMode(
  host: QenexHost,
  mode: ApprovalMode,
): void {
  host.storage.set(PREF_APPROVAL_MODE, mode);
}

async function bridgeUrl(host: QenexHost, path: string): Promise<string> {
  const base = (await host.getBridgeBaseUrl()).replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function readBridgeJson(
  res: Response,
): Promise<unknown> {
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

function throwBridgeError(res: Response, json: unknown, fallback: string): never {
  const body = json as BridgeErrorBody;
  throw new BridgeClientError(
    body.error?.code ?? "internal_error",
    body.error?.message ?? fallback,
    res.status,
    body.error?.details,
  );
}

export async function createSession(
  host: QenexHost,
  cwd: string,
): Promise<SessionInfo> {
  const url = await bridgeUrl(host, "/api/sessions");
  const res = await host.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `createSession failed (${res.status})`);
  }
  return json as SessionInfo;
}

export async function listSessions(host: QenexHost): Promise<SessionInfo[]> {
  const url = await bridgeUrl(host, "/api/sessions");
  const res = await host.fetch(url);
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `listSessions failed (${res.status})`);
  }
  const sessions = (json as { sessions?: SessionInfo[] }).sessions;
  return Array.isArray(sessions) ? sessions : [];
}

export async function deleteSession(
  host: QenexHost,
  sessionId: string,
): Promise<void> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  const res = await host.fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const json = await readBridgeJson(res);
    throwBridgeError(res, json, `deleteSession failed (${res.status})`);
  }
}

export async function healthCheck(
  host: QenexHost,
): Promise<{ ok: boolean; opencode: string | null }> {
  const url = await bridgeUrl(host, "/health");
  const res = await host.fetch(url);
  if (!res.ok) {
    throw new BridgeClientError(
      "health_failed",
      `health check failed (${res.status})`,
      res.status,
    );
  }
  return (await res.json()) as { ok: boolean; opencode: string | null };
}

export async function listPendingApprovals(
  host: QenexHost,
  sessionId: string,
): Promise<PendingApproval[]> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/approvals`,
  );
  const res = await host.fetch(url);
  const json = await readBridgeJson(res);
  if (!res.ok) {
    throwBridgeError(res, json, `listPendingApprovals failed (${res.status})`);
  }
  return (json as { approvals: PendingApproval[] }).approvals;
}

export async function respondToApproval(
  host: QenexHost,
  sessionId: string,
  approvalId: string,
  optionId: string,
): Promise<void> {
  const url = await bridgeUrl(
    host,
    `/api/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
  );
  const res = await host.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ optionId }),
  });
  if (!res.ok) {
    const json = await readBridgeJson(res);
    throwBridgeError(res, json, `respondToApproval failed (${res.status})`);
  }
}

/** Defensive parse of UIMessage.metadata — never throws. */
export function parseMessageMetadata(
  value: unknown,
): QenexMessageMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const out: QenexMessageMetadata = {};

  if (Array.isArray(raw.plan)) {
    const plan: PlanEntry[] = [];
    for (const item of raw.plan) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (typeof content !== "string") continue;
      const priority = (item as { priority?: unknown }).priority;
      const status = (item as { status?: unknown }).status;
      plan.push({
        content,
        ...(typeof priority === "string" ? { priority } : {}),
        ...(typeof status === "string" ? { status } : {}),
      });
    }
    if (plan.length) out.plan = plan;
  }

  if (Array.isArray(raw.diffs)) {
    const diffs: DiffMeta[] = [];
    for (const item of raw.diffs) {
      if (!item || typeof item !== "object") continue;
      const path = (item as { path?: unknown }).path;
      const newText = (item as { newText?: unknown }).newText;
      if (typeof path !== "string" || typeof newText !== "string") continue;
      const oldText = (item as { oldText?: unknown }).oldText;
      const toolCallId = (item as { toolCallId?: unknown }).toolCallId;
      diffs.push({
        type: "diff",
        path,
        newText,
        ...(oldText === null || typeof oldText === "string"
          ? { oldText: oldText as string | null }
          : {}),
        ...(typeof toolCallId === "string" ? { toolCallId } : {}),
      });
    }
    if (diffs.length) out.diffs = diffs;
  }

  if (Array.isArray(raw.terminals)) {
    const terminals: TerminalMeta[] = [];
    for (const item of raw.terminals) {
      if (!item || typeof item !== "object") continue;
      const terminalId = (item as { terminalId?: unknown }).terminalId;
      if (typeof terminalId !== "string") continue;
      const toolCallId = (item as { toolCallId?: unknown }).toolCallId;
      terminals.push({
        type: "terminal",
        terminalId,
        ...(typeof toolCallId === "string" ? { toolCallId } : {}),
      });
    }
    if (terminals.length) out.terminals = terminals;
  }

  return out.plan || out.diffs || out.terminals ? out : undefined;
}
