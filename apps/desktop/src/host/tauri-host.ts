import type { QenexHost } from "@qenex/platform";
import { invoke } from "@tauri-apps/api/core";

const storagePrefix = "qenex:";

function resolveUrl(path: string, baseUrl: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    try {
      const target = new URL(path);
      const bridge = new URL(baseUrl);
      if (
        (target.hostname === "127.0.0.1" || target.hostname === "localhost") &&
        (bridge.hostname === "127.0.0.1" || bridge.hostname === "localhost")
      ) {
        return `${bridge.origin}${target.pathname}${target.search}${target.hash}`;
      }
    } catch {
      // Preserve malformed/external absolute URLs for native fetch to report.
    }
    return path;
  }
  const base = baseUrl.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

function wasAborted(error: unknown, init?: RequestInit): boolean {
  return (
    init?.signal?.aborted === true ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

export function createTauriHost(): QenexHost {
  return {
    kind: "tauri",

    async getBridgeBaseUrl() {
      return invoke<string>("cmd_get_bridge_url");
    },

    async fetch(path, init) {
      let baseUrl: string;
      try {
        baseUrl = await this.getBridgeBaseUrl();
      } catch {
        baseUrl = await invoke<string>("cmd_restart_bridge");
      }
      try {
        return await fetch(resolveUrl(path, baseUrl), init);
      } catch (error) {
        if (wasAborted(error, init)) throw error;
        const method = init?.method?.toUpperCase() ?? "GET";
        if (method !== "GET" && method !== "HEAD") throw error;
        const restarted = await invoke<string>("cmd_restart_bridge");
        try {
          return await fetch(resolveUrl(path, restarted), init);
        } catch {
          throw error;
        }
      }
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
