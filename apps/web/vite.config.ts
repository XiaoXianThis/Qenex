import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";

const agentTestWorkspace = path.resolve(__dirname, "../../agent-test");
fs.mkdirSync(agentTestWorkspace, { recursive: true });

export default defineConfig(({ mode }) => ({
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
  define:
    mode === "development"
      ? {
          "import.meta.env.VITE_DEFAULT_WORKSPACE": JSON.stringify(
            agentTestWorkspace,
          ),
        }
      : undefined,
  server: {
    port: 3000,
    proxy: {
      "/ag-ui": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/v2": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
}));
