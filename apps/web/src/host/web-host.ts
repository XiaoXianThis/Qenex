import type { QenexHost } from "@qenex/platform";

const LEGACY_TABS_KEY = "agent-center-tabs";
const storagePrefix = "qenex:";

function resolveUrl(path: string, baseUrl: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (!baseUrl) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  const base = baseUrl.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

function readStorageItem(key: string): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const prefixedKey = `${storagePrefix}${key}`;
  const existing = localStorage.getItem(prefixedKey);
  if (existing) {
    return existing;
  }

  if (key !== LEGACY_TABS_KEY) {
    return null;
  }

  const legacy = localStorage.getItem(LEGACY_TABS_KEY);
  if (!legacy) {
    return null;
  }

  localStorage.setItem(prefixedKey, legacy);
  localStorage.removeItem(LEGACY_TABS_KEY);
  return legacy;
}

export function createWebHost(): QenexHost {
  return {
    kind: "web",

    async getBridgeBaseUrl() {
      return import.meta.env.VITE_BRIDGE_BASE_URL ?? "";
    },

    async fetch(path, init) {
      const baseUrl = await this.getBridgeBaseUrl();
      return fetch(resolveUrl(path, baseUrl), init);
    },

    async pickWorkspace() {
      if (typeof window === "undefined") {
        return null;
      }

      const fallback = import.meta.env.VITE_DEFAULT_WORKSPACE ?? "";
      const input = window.prompt(
        "请输入本机已存在的项目目录绝对路径（例如 /Users/你/项目）",
        fallback,
      );
      if (!input?.trim()) {
        return null;
      }
      return input.trim();
    },

    async getDefaultWorkspace() {
      const fromEnv = import.meta.env.VITE_DEFAULT_WORKSPACE;
      if (typeof fromEnv === "string" && fromEnv.trim()) {
        return fromEnv.trim();
      }
      return null;
    },

    storage: {
      async get(key) {
        return readStorageItem(key);
      },
      async set(key, value) {
        if (typeof localStorage === "undefined") {
          return;
        }
        localStorage.setItem(`${storagePrefix}${key}`, value);
      },
      async remove(key) {
        if (typeof localStorage === "undefined") {
          return;
        }
        localStorage.removeItem(`${storagePrefix}${key}`);
      },
    },
  };
}
