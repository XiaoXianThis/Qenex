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
  return getBridgeHost().fetch(path, init);
}

export type BridgeErrorBody = {
  detail?: string;
  code?: string;
  methods?: AuthMethodInfo[];
  agentName?: string | null;
  [key: string]: unknown;
};

export type AuthMethodInfo = {
  id: string;
  type: string;
  name: string;
  description?: string | null;
  externalHint?: string | null;
};

export type AuthRequiredPayload = {
  code: "auth_required";
  detail: string;
  methods: AuthMethodInfo[];
  agentName?: string | null;
};

export class BridgeApiError extends Error {
  readonly status: number;
  readonly body: BridgeErrorBody;

  constructor(status: number, body: BridgeErrorBody) {
    super(body.detail || `HTTP ${status}`);
    this.name = "BridgeApiError";
    this.status = status;
    this.body = body;
  }

  get code(): string | undefined {
    return typeof this.body.code === "string" ? this.body.code : undefined;
  }

  asAuthRequired(): AuthRequiredPayload | null {
    if (this.code !== "auth_required") {
      return null;
    }
    const methods = Array.isArray(this.body.methods)
      ? (this.body.methods as AuthMethodInfo[])
      : [];
    return {
      code: "auth_required",
      detail: this.message,
      methods,
      agentName:
        typeof this.body.agentName === "string" ? this.body.agentName : null,
    };
  }
}

export function isAuthRequiredError(
  error: unknown,
): error is BridgeApiError & { asAuthRequired(): AuthRequiredPayload } {
  return (
    error instanceof BridgeApiError && error.code === "auth_required"
  );
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
        ? (error as BridgeErrorBody)
        : { detail: response.statusText };
    if (!body.detail) {
      body.detail = response.statusText;
    }
    throw new BridgeApiError(response.status, body);
  }

  return response.json() as Promise<T>;
}

export function resolveAguiUrl(baseUrl: string): string {
  if (!baseUrl) {
    return import.meta.env.VITE_AGUI_URL ?? "/ag-ui";
  }
  return `${baseUrl.replace(/\/$/, "")}/ag-ui`;
}

export async function getAguiUrl(): Promise<string> {
  const baseUrl = await getBridgeHost().getBridgeBaseUrl();
  return resolveAguiUrl(baseUrl);
}
