import type { QenexHost } from "@qenex/platform";

const storagePrefix = "qenex:";

type VSCodeApi = {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type ExtensionToWebviewMessage =
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

function postMessageWithReply<T>(
  api: VSCodeApi,
  message: Record<string, unknown>,
): Promise<T> {
  const requestId = ++requestCounter;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    api.postMessage({ ...message, requestId });
    window.setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Request timed out: ${message.type}`));
      }
    }, 30_000);
  });
}

function handleExtensionMessage(message: ExtensionToWebviewMessage): void {
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
    default:
      return;
  }
}

export function installVscodeMessageBridge(api: VSCodeApi): void {
  window.addEventListener("message", (event) => {
    const message = event.data as ExtensionToWebviewMessage;
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }
    handleExtensionMessage(message);
  });

  api.postMessage({ type: "ready" });
}

export function createVscodeHost(api: VSCodeApi): QenexHost {
  return {
    kind: "vscode",

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
      const path = await postMessageWithReply<string | null>(api, {
        type: "pick-workspace",
      });
      return path;
    },

    async getDefaultWorkspace() {
      if (defaultWorkspace) {
        return defaultWorkspace;
      }
      await this.getBridgeBaseUrl();
      return defaultWorkspace;
    },

    storage: {
      async get(key) {
        const value = await postMessageWithReply<string | null>(api, {
          type: "storage-get",
          key,
        });
        return value;
      },
      async set(key, value) {
        await postMessageWithReply<null>(api, {
          type: "storage-set",
          key,
          value,
        });
      },
      async remove(key) {
        await postMessageWithReply<null>(api, {
          type: "storage-remove",
          key,
        });
      },
    },
  };
}

export { storagePrefix };
