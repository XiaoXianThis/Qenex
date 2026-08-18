import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";

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
  base: "./",
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
      "@": path.resolve(__dirname, "../../../packages/ui/src"),
    },
  },
  build: {
    outDir: "../src/main/resources/webview",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
        manualChunks: vendorManualChunks,
      },
    },
  },
});
