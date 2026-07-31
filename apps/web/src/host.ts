import type { QenexHost } from "@qenex/core";

/**
 * Web shell host: same-origin `/api` via Vite proxy. No IDE/desktop APIs.
 */
export function createWebHost(): QenexHost {
  return {
    kind: "web",
    getBridgeBaseUrl: () => "",
    fetch: globalThis.fetch.bind(globalThis),
    storage: {
      get: (key) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* private mode */
        }
      },
      remove: (key) => {
        try {
          localStorage.removeItem(key);
        } catch {
          /* private mode */
        }
      },
    },
  };
}
