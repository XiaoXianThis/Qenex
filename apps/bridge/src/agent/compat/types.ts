/**
 * Thin per-agent runtime compatibility. Launch command / aliases stay in detect.ts.
 * Do not add normalizeSession or install-domain fields here.
 */

import type { NormalizedAcpSessionConfig } from "../../acp-session-config.ts";

export type AgentPhase =
  | "launch"
  | "session-init"
  | "session-load"
  | "chat"
  | "config";

export type ConfigDiscovery = "advertised" | "per-model-probe-fallback";

export type ResumeBehavior = "native-load" | "reconnect-fresh" | "none";

export type LaunchContext = {
  cwd: string;
  agentId: string;
  command: string[];
  env?: Record<string, string>;
  existingSessionId?: string;
  persistSession?: boolean;
};

export type LaunchPatch = {
  env?: Record<string, string | undefined>;
  args?: string[];
};

export type NormalizedAgentError = {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
};

/** ACP / Bridge auth method shape consumed via BridgeError.details.methods. */
export type AgentAuthMethod = {
  id: string;
  type: string;
  name: string;
  description?: string | null;
  externalHint?: string | null;
};

export interface AgentCompat {
  id: string;
  augmentLaunch?(ctx: LaunchContext): LaunchPatch;
  /**
   * Extra argv after the resolved agent binary to open a browser login.
   * Cursor: `["login"]` → `agent login` / `cursor-agent login`.
   * ACP `authenticate` does not open a browser for Cursor.
   */
  loginArgv?: string[];
  configDiscovery: ConfigDiscovery;
  resume: ResumeBehavior;
  /**
   * Extra `_meta` on ACP initialize `clientCapabilities`. Provider replaces
   * the whole capabilities object (`??`), so spawn merges this onto the
   * default fs/terminal flags. Cursor: `{ parameterizedModelPicker: true }`.
   */
  initializeMeta?: Record<string, unknown>;
  classifyError?(error: unknown, phase: AgentPhase): NormalizedAgentError | null;
  /**
   * Optional rewrite of advertised/probed catalog before session-store writes
   * live info or the agentId::cwd cache. Implement in per-agent compat modules;
   * session-store only calls this when present.
   */
  normalizeCatalog?(cfg: NormalizedAcpSessionConfig): NormalizedAcpSessionConfig;
}

/** Provider default when `initialize.clientCapabilities` is omitted. */
export const DEFAULT_ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
} as const;

/**
 * ACP initialize payload for `createACPProvider`. `protocolVersion` is left
 * unset so the provider fills its SDK constant.
 */
export function acpInitializeFromCompat(
  compat: Pick<AgentCompat, "initializeMeta">,
):
  | {
      clientCapabilities: {
        fs: { readTextFile: boolean; writeTextFile: boolean };
        terminal: boolean;
        _meta: Record<string, unknown>;
      };
    }
  | undefined {
  const meta = compat.initializeMeta;
  if (!meta || Object.keys(meta).length === 0) return undefined;
  return {
    clientCapabilities: {
      fs: { ...DEFAULT_ACP_CLIENT_CAPABILITIES.fs },
      terminal: DEFAULT_ACP_CLIENT_CAPABILITIES.terminal,
      _meta: meta,
    },
  };
}

/**
 * `<launchBin> …loginArgv`. Null when the binary or argv is missing.
 */
export function cliLoginCommand(
  launchCommand: string[],
  loginArgv: string[] | undefined,
): string[] | null {
  const bin = launchCommand[0]?.trim();
  if (!bin || !loginArgv?.length) return null;
  return [bin, ...loginArgv];
}

const MAX_ERROR_WALK = 6;
/** ACP `authenticate` required (see @mcpc-tech/acp-ai-provider lazy-auth). */
const ACP_AUTH_REQUIRED_ERROR_CODE = -32000;

const AUTH_REQUIRED_CODES = new Set([
  "auth_required",
  "opencode_auth_required",
]);

/** Prefer browser / OAuth methods when initialize advertised several. */
const PREFERRED_AUTH_METHOD_IDS = [
  "cursor_login",
  "chat-gpt",
  "oauth-personal",
  "google_login",
  "qodercli-login",
];

export function isAuthRequiredErrorCode(code: string | undefined): boolean {
  return typeof code === "string" && AUTH_REQUIRED_CODES.has(code);
}

/**
 * Choose the ACP `authenticate` methodId to run in-process.
 * Prefers known browser/OAuth ids; otherwise the first method whose id/type/name
 * looks interactive. Returns null when nothing can be opened.
 */
export function pickInteractiveAuthMethodId(raw: unknown): string | null {
  const methods = normalizeAuthMethods(raw);
  if (methods.length === 0) return null;
  for (const id of PREFERRED_AUTH_METHOD_IDS) {
    if (methods.some((method) => method.id === id)) return id;
  }
  const interactive = methods.find((method) =>
    /login|oauth|browser/i.test(`${method.id} ${method.type} ${method.name}`),
  );
  return interactive?.id ?? methods[0]?.id ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pushText(parts: string[], value: string): void {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "[object Object]") return;
  if (parts.includes(trimmed)) return;
  parts.push(trimmed);
}

function collectErrorParts(
  error: unknown,
  parts: string[],
  seen: Set<unknown>,
  depth: number,
): void {
  if (error == null || depth > MAX_ERROR_WALK) return;
  if (typeof error === "string") {
    pushText(parts, error);
    return;
  }
  if (typeof error === "number" || typeof error === "boolean") {
    pushText(parts, String(error));
    return;
  }
  if (typeof error !== "object") {
    pushText(parts, String(error));
    return;
  }
  if (seen.has(error)) return;
  seen.add(error);

  if (Array.isArray(error)) {
    for (const item of error) collectErrorParts(item, parts, seen, depth + 1);
    return;
  }

  if (error instanceof Error) {
    pushText(parts, error.message);
    const extra = error as Error & {
      data?: unknown;
      details?: unknown;
      cause?: unknown;
    };
    collectErrorParts(extra.data, parts, seen, depth + 1);
    collectErrorParts(extra.details, parts, seen, depth + 1);
    collectErrorParts(error.cause, parts, seen, depth + 1);
    return;
  }

  const rec = error as Record<string, unknown>;
  for (const key of ["message", "details", "error", "reason", "cause"] as const) {
    const value = rec[key];
    if (typeof value === "string") pushText(parts, value);
  }
  collectErrorParts(rec.data, parts, seen, depth + 1);
  collectErrorParts(rec.details, parts, seen, depth + 1);
  collectErrorParts(rec.cause, parts, seen, depth + 1);
  collectErrorParts(rec.error, parts, seen, depth + 1);
}

/**
 * Flatten ACP JSON-RPC objects, nested `data.details`, and `cause` into a
 * searchable string. Never returns `[object Object]`.
 */
export function errorText(error: unknown): string {
  const parts: string[] = [];
  collectErrorParts(error, parts, new Set(), 0);
  return parts.join(" ").trim();
}

const JSON_RPC_METHOD_NOT_FOUND = -32601;

function jsonRpcCode(error: unknown): number | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): number | null => {
    if (value == null || depth > MAX_ERROR_WALK) return null;
    if (!isRecord(value)) return null;
    if (seen.has(value)) return null;
    seen.add(value);
    if (typeof value.code === "number") return value.code;
    const extra = value as { data?: unknown; cause?: unknown };
    return visit(extra.data, depth + 1) ?? visit(extra.cause, depth + 1);
  };
  return visit(error, 0);
}

/** JSON-RPC -32601, or a wrapped "Method not found" from the ACP child. */
export function isAcpMethodNotFound(error: unknown): boolean {
  if (jsonRpcCode(error) === JSON_RPC_METHOD_NOT_FOUND) return true;
  return /method not found/i.test(errorText(error));
}

function isMethodish(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && value.id.trim().length > 0;
}

export function normalizeAuthMethods(raw: unknown): AgentAuthMethod[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAuthMethod[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      const id = item.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, type: id, name: id });
      continue;
    }
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name =
      typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;
    const type =
      typeof item.type === "string" && item.type.trim() ? item.type.trim() : id;
    const description =
      typeof item.description === "string" ? item.description : null;
    const externalHint =
      typeof item.externalHint === "string"
        ? item.externalHint
        : typeof item.hint === "string"
          ? item.hint
          : null;
    out.push({
      id,
      type,
      name,
      ...(description ? { description } : {}),
      ...(externalHint ? { externalHint } : {}),
    });
  }
  return out;
}

export function mergeAuthMethods(...sources: unknown[]): AgentAuthMethod[] {
  const byId = new Map<string, AgentAuthMethod>();
  for (const source of sources) {
    for (const method of normalizeAuthMethods(source)) {
      const prev = byId.get(method.id);
      if (!prev) {
        byId.set(method.id, method);
        continue;
      }
      byId.set(method.id, {
        id: method.id,
        type: method.type && method.type !== method.id ? method.type : prev.type,
        name: method.name && method.name !== method.id ? method.name : prev.name,
        description: method.description ?? prev.description,
        externalHint: method.externalHint ?? prev.externalHint,
      });
    }
  }
  return [...byId.values()];
}

/** Pull `authMethods` / `methods` off JSON-RPC errors, Error.data, and cause. */
export function extractAuthMethods(error: unknown): AgentAuthMethod[] {
  const found: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (value == null || depth > MAX_ERROR_WALK) return;
    if (!isRecord(value) && !Array.isArray(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.some(isMethodish)) found.push(...value);
      else for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const key of ["authMethods", "methods"] as const) {
      if (Array.isArray(value[key])) found.push(...(value[key] as unknown[]));
    }
    visit(value.data, depth + 1);
    visit(value.details, depth + 1);
    visit(value.cause, depth + 1);
    if (value instanceof Error) {
      visit((value as Error & { data?: unknown }).data, depth + 1);
    }
  };
  visit(error, 0);
  return normalizeAuthMethods(found);
}

/** Personal Google / Code Assist-for-individuals OAuth is retired (June 2026). */
export function isGeminiConsumerOauthBlocked(error: unknown): boolean {
  return /no longer supported for Gemini Code Assist for individuals|migrate to the Antigravity|antigravity\.google/i.test(
    errorText(error),
  );
}

export function inspectAgentError(
  error: unknown,
): "auth" | "spawn" | "balance" | "model" | null {
  const message = errorText(error);
  const lower = message.toLowerCase();
  if (
    /insufficient\s*balance|余额不足|quota\s*exceeded|rate\s*limit|billing|payment.?required|credit/i.test(
      message,
    )
  ) {
    return "balance";
  }
  // Must run before the -32000 / "authenticating" auth match.
  if (isGeminiConsumerOauthBlocked(error)) {
    return null;
  }
  if (jsonRpcCode(error) === ACP_AUTH_REQUIRED_ERROR_CODE) {
    return "auth";
  }
  if (
    /auth|login|unauthori[sz]ed|not authenticated|authentication|token expired|please\s+run\s+.*login|please\s+run\s+gemini|gemini\s+(auth|login)|opencode\s+auth|cursor.?login|agent login|qodercli-login/i.test(
      lower,
    )
  ) {
    return "auth";
  }
  // Opaque ACP "Internal error" plus nested login/auth details.
  if (
    /\binternal error\b/i.test(lower) &&
    /login|auth|unauthori[sz]ed/i.test(lower)
  ) {
    return "auth";
  }
  if (/model.?not.?found|unknown.?model|no.?model|invalid.?model/i.test(lower)) {
    return "model";
  }
  if (
    /spawn|enoent|eacces|eperm|failed to start|cannot find|exited with code|signal\s|broken pipe|process\s+.*exited/i.test(
      lower,
    )
  ) {
    return "spawn";
  }
  return null;
}
