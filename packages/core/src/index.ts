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

const PREF_CWD = "qenex:last-cwd";
const PREF_THEME = "qenex:theme";

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

async function bridgeUrl(host: QenexHost, path: string): Promise<string> {
  const base = (await host.getBridgeBaseUrl()).replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
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
  const json = (await res.json()) as SessionInfo | BridgeErrorBody;
  if (!res.ok) {
    const err = json as BridgeErrorBody;
    throw new Error(err.error?.message ?? `createSession failed (${res.status})`);
  }
  return json as SessionInfo;
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
    const json = (await res.json()) as BridgeErrorBody;
    throw new Error(
      json.error?.message ?? `deleteSession failed (${res.status})`,
    );
  }
}

export async function healthCheck(
  host: QenexHost,
): Promise<{ ok: boolean; opencode: string | null }> {
  const url = await bridgeUrl(host, "/health");
  const res = await host.fetch(url);
  if (!res.ok) throw new Error(`health check failed (${res.status})`);
  return (await res.json()) as { ok: boolean; opencode: string | null };
}
