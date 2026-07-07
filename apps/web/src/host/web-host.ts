import type { QenexHost } from "@qenex/platform";

const DEFAULT_BRIDGE_BASE = "http://localhost:8000";

function resolveUrl(path: string, baseUrl: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const base = baseUrl.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export function createWebHost(): QenexHost {
  const storagePrefix = "qenex:";

  return {
    kind: "web",

    async getBridgeBaseUrl() {
      return import.meta.env.VITE_BRIDGE_BASE_URL ?? DEFAULT_BRIDGE_BASE;
    },

    async fetch(path, init) {
      const baseUrl = await this.getBridgeBaseUrl();
      return fetch(resolveUrl(path, baseUrl), init);
    },

    async pickWorkspace() {
      return ".";
    },

    async getDefaultWorkspace() {
      return ".";
    },

    storage: {
      async get(key) {
        return localStorage.getItem(`${storagePrefix}${key}`);
      },
      async set(key, value) {
        localStorage.setItem(`${storagePrefix}${key}`, value);
      },
      async remove(key) {
        localStorage.removeItem(`${storagePrefix}${key}`);
      },
    },
  };
}
