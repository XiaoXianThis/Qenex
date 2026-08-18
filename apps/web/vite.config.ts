import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";

const agentTestWorkspace = path.resolve(__dirname, "../../agent-test");
fs.mkdirSync(agentTestWorkspace, { recursive: true });

function vendorManualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return;
  if (
    id.includes("@codemirror") ||
    id.includes("@uiw/codemirror") ||
    id.includes("@uiw/react-codemirror")
  ) {
    return "codemirror";
  }
  if (id.includes("beautiful-mermaid")) return "mermaid";
  if (id.includes("@shikijs/langs")) return;
  if (
    id.includes("react-shiki") ||
    id.includes("@shikijs/") ||
    id.includes("shiki/wasm") ||
    /[/\\]shiki[/\\]/.test(id)
  ) {
    return "shiki";
  }
}

export default defineConfig({
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        svgoConfig: {
          plugins: [
            {
              name: "preset-default",
              params: { overrides: { removeViewBox: false } },
            },
            { name: "convertColors", params: { currentColor: true } },
          ],
        },
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  define: {
    "import.meta.env.VITE_DEFAULT_WORKSPACE": JSON.stringify(agentTestWorkspace),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorManualChunks,
      },
    },
  },
  server: {
    port: 3000,
    // Bun Bridge: /api + /health + /v2/agents (M6 registry/install/ensure).
    proxy: {
      "/health": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/v2": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
