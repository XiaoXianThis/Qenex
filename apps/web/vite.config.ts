import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const bridge =
  process.env.QENEX_BRIDGE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@qenex/ui/styles.css": resolve(
        __dirname,
        "../../packages/ui/src/styles.css",
      ),
      "@qenex/ui": resolve(__dirname, "../../packages/ui/src"),
      "@qenex/core": resolve(__dirname, "../../packages/core/src"),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": { target: bridge, changeOrigin: true },
      "/health": { target: bridge, changeOrigin: true },
      "/ag-ui": { target: bridge, changeOrigin: true },
    },
  },
  preview: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": { target: bridge, changeOrigin: true },
      "/health": { target: bridge, changeOrigin: true },
    },
  },
});
