import type {
  HostThemeColors,
  HostThemeKind,
  HostThemeSnapshot,
  QenexHost,
} from "@qenex/platform";

const storagePrefix = "qenex:";

type QenexBridge = {
  postMessage(message: unknown): void;
};

type HostToWebviewMessage =
  | {
      type: "bridge-ready";
      url: string;
      defaultWorkspace: string | null;
    }
  | {
      type: "storage-result";
      requestId: number;
      value?: string | null;
    }
  | {
      type: "pick-workspace-result";
      requestId: number;
      path: string | null;
    }
  | {
      type: "get-default-workspace-result";
      requestId: number;
      path: string | null;
    }
  | {
      type: "host-theme-result";
      requestId: number;
      theme: HostThemeSnapshot;
    }
  | {
      type: "theme-update";
      theme: HostThemeSnapshot;
    };

function resolveUrl(path: string, baseUrl: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const base = baseUrl.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

let bridgeBaseUrl: string | null = null;
let defaultWorkspace: string | null = null;
const bridgeReadyWaiters: Array<(url: string) => void> = [];

let requestCounter = 0;
const pendingRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

let lastHostTheme: HostThemeSnapshot | null = null;
const themeListeners = new Set<(theme: HostThemeSnapshot) => void>();

function normalizeTheme(raw: HostThemeSnapshot): HostThemeSnapshot {
  const kind: HostThemeKind =
    raw.kind === "dark" ||
    raw.kind === "highContrast" ||
    raw.kind === "highContrastLight" ||
    raw.kind === "light"
      ? raw.kind
      : "dark";
  const colors: HostThemeColors =
    raw.colors && typeof raw.colors === "object" ? raw.colors : {};
  return { kind, colors };
}

function emitHostTheme(raw: HostThemeSnapshot): HostThemeSnapshot {
  const snapshot = normalizeTheme(raw);
  lastHostTheme = snapshot;
  for (const listener of themeListeners) {
    listener(snapshot);
  }
  return snapshot;
}

function getBridge(): QenexBridge | undefined {
  return window.__qenexBridge;
}

/** Kotlin injects `__qenexBridge` on CefLoadHandler.onLoadEnd — may race React hydrate. */
function waitForBridge(timeoutMs = 15_000): Promise<QenexBridge> {
  const existing = getBridge();
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise<QenexBridge>((resolve, reject) => {
    let settled = false;
    const finish = (bridge: QenexBridge) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("qenex-bridge-injected", onInjected);
      resolve(bridge);
    };

    const onInjected = () => {
      const bridge = getBridge();
      if (bridge) {
        finish(bridge);
      }
    };

    window.addEventListener("qenex-bridge-injected", onInjected);
    const pollId = window.setInterval(() => {
      const bridge = getBridge();
      if (bridge) {
        finish(bridge);
      }
    }, 50);
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(pollId);
      window.removeEventListener("qenex-bridge-injected", onInjected);
      reject(new Error("JetBrains bridge is not ready"));
    }, timeoutMs);
  });
}

async function postMessageWithReply<T>(
  message: Record<string, unknown>,
): Promise<T> {
  const requestId = ++requestCounter;
  const bridge = await waitForBridge();
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    bridge.postMessage({ ...message, requestId });
    window.setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Request timed out: ${message.type}`));
      }
    }, 30_000);
  });
}

function handleHostMessage(message: HostToWebviewMessage): void {
  switch (message.type) {
    case "bridge-ready": {
      bridgeBaseUrl = message.url;
      defaultWorkspace = message.defaultWorkspace;
      for (const waiter of bridgeReadyWaiters) {
        waiter(message.url);
      }
      bridgeReadyWaiters.length = 0;
      return;
    }
    case "storage-result": {
      const pending = pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(message.requestId);
      pending.resolve(message.value ?? null);
      return;
    }
    case "pick-workspace-result": {
      const pending = pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(message.requestId);
      pending.resolve(message.path);
      return;
    }
    case "get-default-workspace-result": {
      const pending = pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(message.requestId);
      if (message.path) {
        defaultWorkspace = message.path;
      }
      pending.resolve(message.path);
      return;
    }
    case "host-theme-result": {
      const pending = pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(message.requestId);
      pending.resolve(emitHostTheme(message.theme));
      return;
    }
    case "theme-update": {
      emitHostTheme(message.theme);
      return;
    }
    default:
      return;
  }
}

export function installJetbrainsMessageBridge(): void {
  window.addEventListener("message", (event) => {
    const message = event.data as HostToWebviewMessage & {
      type?: string;
      message?: string;
    };
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }
    if (message.type === "bridge-error") {
      console.error("[qenex] bridge failed to start:", message.message);
      return;
    }
    handleHostMessage(message as HostToWebviewMessage);
  });

  void waitForBridge()
    .then((bridge) => {
      bridge.postMessage({ type: "ready" });
    })
    .catch((error) => {
      console.error("[qenex] failed to notify host ready:", error);
    });
}

export function createJetbrainsHost(): QenexHost {
  return {
    kind: "jetbrains",

    async getBridgeBaseUrl() {
      if (bridgeBaseUrl) {
        return bridgeBaseUrl;
      }
      return new Promise((resolve) => {
        bridgeReadyWaiters.push(resolve);
      });
    },

    async fetch(path, init) {
      const baseUrl = await this.getBridgeBaseUrl();
      return fetch(resolveUrl(path, baseUrl), init);
    },

    async pickWorkspace() {
      const path = await postMessageWithReply<string | null>({
        type: "pick-workspace",
      });
      return path;
    },

    async getDefaultWorkspace() {
      if (defaultWorkspace) {
        return defaultWorkspace;
      }
      await this.getBridgeBaseUrl();
      if (defaultWorkspace) {
        return defaultWorkspace;
      }
      const path = await postMessageWithReply<string | null>({
        type: "get-default-workspace",
      });
      return path;
    },

    storage: {
      async get(key) {
        const value = await postMessageWithReply<string | null>({
          type: "storage-get",
          key,
        });
        return value;
      },
      async set(key, value) {
        await postMessageWithReply<null>({
          type: "storage-set",
          key,
          value,
        });
      },
      async remove(key) {
        await postMessageWithReply<null>({
          type: "storage-remove",
          key,
        });
      },
    },

    async getHostTheme() {
      if (lastHostTheme) {
        return lastHostTheme;
      }
      try {
        return await postMessageWithReply<HostThemeSnapshot>({
          type: "get-host-theme",
        });
      } catch {
        return null;
      }
    },

    onHostThemeChange(cb) {
      themeListeners.add(cb);
      return () => {
        themeListeners.delete(cb);
      };
    },
  };
}

declare global {
  interface Window {
    __qenexBridge?: QenexBridge;
  }
}

export { storagePrefix };
