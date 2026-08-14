/**
 * VS Code extension build (M9): webview + host + staged Bun Bridge.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageBunBridge } from "./lib/stage-bun-bridge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = join(root, "apps", "vscode");
const stageDir = join(vscodeDir, "bridge");

console.log("[m9] Staging Bun Bridge into apps/vscode/bridge…");
stageBunBridge(stageDir);

console.log("Building VS Code webview...");
execSync("bun run build", {
  cwd: join(vscodeDir, "webview"),
  stdio: "inherit",
});

console.log("Compiling extension host...");
execSync("node esbuild.mjs", { cwd: vscodeDir, stdio: "inherit" });

if (!existsSync(join(stageDir, "index.js"))) {
  throw new Error("staged bridge missing bundled index.js");
}

console.log("");
console.log("VS Code extension build complete → apps/vscode/");
console.log("  Requires system Bun on PATH (or QENEX_BUN_BIN).");
console.log("  F5 / package:vscode uses apps/vscode/bridge/ as packaged entry.");
