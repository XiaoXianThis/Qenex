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
    const detail =
      typeof error === "object" && error && "detail" in error
        ? String((error as { detail?: string }).detail)
        : response.statusText;
    throw new Error(detail || `HTTP ${response.status}`);
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
