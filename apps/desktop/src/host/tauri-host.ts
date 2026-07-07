import type { QenexHost } from "@qenex/platform";
import { invoke } from "@tauri-apps/api/core";

const storagePrefix = "qenex:";

function resolveUrl(path: string, baseUrl: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const base = baseUrl.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export function createTauriHost(): QenexHost {
  return {
    kind: "tauri",

    async getBridgeBaseUrl() {
      return invoke<string>("cmd_get_bridge_url");
    },

    async fetch(path, init) {
      const baseUrl = await this.getBridgeBaseUrl();
      return fetch(resolveUrl(path, baseUrl), init);
    },

    async pickWorkspace() {
      return invoke<string | null>("cmd_pick_workspace");
    },

    async getDefaultWorkspace() {
      return invoke<string>("cmd_get_default_workspace");
    },

    storage: {
      async get(key) {
        return invoke<string | null>("cmd_storage_get", { key });
      },
      async set(key, value) {
        await invoke("cmd_storage_set", { key, value });
      },
      async remove(key) {
        await invoke("cmd_storage_remove", { key });
      },
    },
  };
}

export { storagePrefix };
