import type { QenexHost } from "@qenex/platform";

let bridgeHost: QenexHost | null = null;

export function setBridgeHost(host: QenexHost): void {
  bridgeHost = host;
}

export function getBridgeHost(): QenexHost {
  if (!bridgeHost) {
    throw new Error("Bridge host not configured. Wrap your app in QenexHostProvider.");
  }
  return bridgeHost;
}

export function clearBridgeHost(): void {
  bridgeHost = null;
}

export async function bridgeFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const signal = init?.signal ?? AbortSignal.timeout(60_000);
  return getBridgeHost().fetch(path, { ...init, signal });
}

export type BridgeErrorBody = {
  detail?: string;
  code?: string;
  methods?: AuthMethodInfo[];
  agentName?: string | null;
  details?: unknown;
  [key: string]: unknown;
};

export type AuthMethodInfo = {
  id: string;
  type: string;
  name: string;
  description?: string | null;
  externalHint?: string | null;
};

/** Browser / OAuth-style ACP methods — the client should expect a login page. */
export function isInteractiveAuthMethod(
  method: Pick<AuthMethodInfo, "id" | "type" | "name"> | null | undefined,
): boolean {
  if (!method) return false;
  return /login|oauth|browser|cursor/i.test(
    `${method.id} ${method.type} ${method.name}`,
  );
}

export type AuthRequiredPayload = {
  code: "auth_required" | "opencode_auth_required";
  detail: string;
  methods: AuthMethodInfo[];
  agentName?: string | null;
};

const AUTH_CODES = new Set(["auth_required", "opencode_auth_required"]);

const AUTH_MESSAGE_RE =
  /auth_required|opencode_auth_required|需要登录|凭证已失效|requires authentication|not authenticated|unauthori[sz]ed|token expired|please\s+run\s+.*login|opencode\s+auth login|agent login/i;

export function isAuthRequiredCode(
  code: string | undefined | null,
): code is "auth_required" | "opencode_auth_required" {
  return typeof code === "string" && AUTH_CODES.has(code);
}

/** Pull a human string out of nested Bridge / ACP error payloads. */
export function stringifyErrorMessage(value: unknown, depth = 0): string {
  if (depth > 5) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[object Object]") return "";
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object") {
          const nested = stringifyErrorMessage(parsed, depth + 1);
          if (nested) return nested;
        }
      } catch {
        /* keep the original string */
      }
    }
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Error) {
    return stringifyErrorMessage(value.message, depth + 1);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyErrorMessage(item, depth + 1))
      .filter(Boolean)
      .join("; ");
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["message", "detail", "error", "cause", "reason", "text"]) {
      if (rec[key] === undefined) continue;
      const nested = stringifyErrorMessage(rec[key], depth + 1);
      if (nested) return nested;
    }
    try {
      const json = JSON.stringify(value);
      if (json && json !== "{}" && json !== "[]") return json;
    } catch {
      return "";
    }
  }
  return "";
}

export function errorCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const rec = error as { code?: unknown };
  return typeof rec.code === "string" ? rec.code : undefined;
}

function isAuthMethodInfo(value: unknown): value is AuthMethodInfo {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.name === "string";
}

export function authMethodsFromUnknown(value: unknown): AuthMethodInfo[] {
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const direct = rec.methods;
  if (Array.isArray(direct)) {
    return direct.filter(isAuthMethodInfo);
  }
  const nestedDetails = rec.details;
  if (nestedDetails && typeof nestedDetails === "object") {
    const nested = (nestedDetails as Record<string, unknown>).methods;
    if (Array.isArray(nested)) {
      return nested.filter(isAuthMethodInfo);
    }
  }
  const nestedError = rec.error;
  if (nestedError && typeof nestedError === "object") {
    return authMethodsFromUnknown(nestedError);
  }
  return [];
}

export function agentNameFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.agentName === "string" && rec.agentName.trim()) {
    return rec.agentName.trim();
  }
  const details = rec.details;
  if (details && typeof details === "object") {
    const nested = (details as Record<string, unknown>).agentName;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  const nestedError = rec.error;
  if (nestedError && typeof nestedError === "object") {
    return agentNameFromUnknown(nestedError);
  }
  return null;
}

export function looksLikeAuthMessage(message: string): boolean {
  return AUTH_MESSAGE_RE.test(message);
}

export class BridgeApiError extends Error {
  readonly status: number;
  readonly body: BridgeErrorBody;

  constructor(status: number, body: BridgeErrorBody) {
    const detail = stringifyErrorMessage(body.detail) || `HTTP ${status}`;
    super(detail);
    this.name = "BridgeApiError";
    this.status = status;
    this.body = { ...body, detail };
  }

  get code(): string | undefined {
    return typeof this.body.code === "string" ? this.body.code : undefined;
  }

  asAuthRequired(): AuthRequiredPayload | null {
    const code = this.code;
    const detail = stringifyErrorMessage(this.message);
    if (!isAuthRequiredCode(code) && !looksLikeAuthMessage(detail)) {
      return null;
    }
    return {
      code: isAuthRequiredCode(code) ? code : "auth_required",
      detail: detail || this.message,
      methods: authMethodsFromUnknown(this.body) || authMethodsFromUnknown(this.body.details),
      agentName:
        agentNameFromUnknown(this.body) ??
        (typeof this.body.agentName === "string" ? this.body.agentName : null),
    };
  }
}

export function isAuthRequiredError(error: unknown): boolean {
  const code = errorCodeOf(error);
  if (isAuthRequiredCode(code)) return true;
  if (error instanceof BridgeApiError) {
    return error.asAuthRequired() != null;
  }
  if (error && typeof error === "object" && "asAuthRequired" in error) {
    const fn = (error as { asAuthRequired?: unknown }).asAuthRequired;
    if (typeof fn === "function") {
      try {
        return fn.call(error) != null;
      } catch {
        /* fall through to message */
      }
    }
  }
  return looksLikeAuthMessage(stringifyErrorMessage(error));
}

type NestedBridgeError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  methods?: unknown;
  agentName?: unknown;
};

function liftNestedBridgeError(body: BridgeErrorBody & { error?: NestedBridgeError }): void {
  const nested = body.error;
  if (!nested || typeof nested !== "object") return;

  if (!body.code && typeof nested.code === "string") {
    body.code = nested.code;
  }

  const nestedMessage = stringifyErrorMessage(nested.message);
  const currentDetail = stringifyErrorMessage(body.detail);
  if (!currentDetail) {
    body.detail = nestedMessage || undefined;
  }

  const details =
    nested.details && typeof nested.details === "object"
      ? (nested.details as Record<string, unknown>)
      : null;
  if (details && body.details == null) {
    body.details = details;
  }

  const methods = authMethodsFromUnknown(nested);
  if ((!body.methods || body.methods.length === 0) && methods.length > 0) {
    body.methods = methods;
  }
  if (body.agentName == null) {
    const name = agentNameFromUnknown(nested);
    if (name) body.agentName = name;
  }
}

export async function fetchJson<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await bridgeFetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    const body =
      typeof error === "object" && error
        ? (error as BridgeErrorBody & { error?: NestedBridgeError })
        : { detail: response.statusText };
    liftNestedBridgeError(body);
    if (!body.detail) {
      body.detail =
        stringifyErrorMessage(body.detail) ||
        stringifyErrorMessage((body as { error?: NestedBridgeError }).error) ||
        response.statusText;
    } else {
      body.detail = stringifyErrorMessage(body.detail) || response.statusText;
    }
    throw new BridgeApiError(response.status, body);
  }

  return response.json() as Promise<T>;
}
