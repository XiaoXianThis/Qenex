import type { QenexHost } from "@qenex/platform";

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

function getBridge(): QenexBridge {
  const bridge = window.__qenexBridge;
  if (!bridge) {
    throw new Error("JetBrains bridge is not ready");
  }
  return bridge;
}

function postMessageWithReply<T>(
  message: Record<string, unknown>,
): Promise<T> {
  const requestId = ++requestCounter;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    getBridge().postMessage({ ...message, requestId });
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
    default:
      return;
  }
}

export function installJetbrainsMessageBridge(): void {
  window.addEventListener("message", (event) => {
    const message = event.data as HostToWebviewMessage & { type?: string; message?: string };
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }
    if (message.type === "bridge-error") {
      console.error("[qenex] bridge failed to start:", message.message);
      return;
    }
    handleHostMessage(message as HostToWebviewMessage);
  });

  const notifyReady = () => {
    if (window.__qenexBridge) {
      window.__qenexBridge.postMessage({ type: "ready" });
      return;
    }
    window.setTimeout(notifyReady, 50);
  };

  window.addEventListener("qenex-bridge-injected", notifyReady, { once: true });
  notifyReady();
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
  };
}

declare global {
  interface Window {
    __qenexBridge?: QenexBridge;
  }
}

export { storagePrefix };
