import { describe, expect, test } from "bun:test";
import { createWebHost } from "../src/host.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

describe("web host", () => {
  test("kind is web and bridge base is same-origin empty", async () => {
    const host = createWebHost();
    expect(host.kind).toBe("web");
    expect(await host.getBridgeBaseUrl()).toBe("");
    expect(host.pickWorkspace).toBeUndefined();
  });

  test("main entry does not import IDE/desktop SDKs", () => {
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
    const main = readFileSync(resolve(root, "src/main.tsx"), "utf8");
    const host = readFileSync(resolve(root, "src/host.ts"), "utf8");
    for (const text of [main, host]) {
      expect(text).not.toMatch(/@tauri-apps|vscode|acquireVsCodeApi|__TAURI__/);
    }
  });
});
