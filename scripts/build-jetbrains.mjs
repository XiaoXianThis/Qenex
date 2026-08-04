/**
 * JetBrains plugin build (M9): webview + Kotlin + stage Bun Bridge resources.
 */
import { chmodSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageBunBridge } from "./lib/stage-bun-bridge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsDir = join(root, "apps", "jetbrains");
const stageDir = join(jetbrainsDir, "build", "qenex-bridge-stage");
const isWin = process.platform === "win32";
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

console.log("[m9] Staging Bun Bridge for JetBrains resources…");
// Lean resources: src + package.json; BridgeProcessManager runs bun install when needed.
stageBunBridge(stageDir, { includeNodeModules: false });

console.log("Building JetBrains webview...");
execSync("bun run build", {
  cwd: join(jetbrainsDir, "webview"),
  stdio: "inherit",
});

if (!isWin) {
  chmodSync(join(jetbrainsDir, "gradlew"), 0o755);
}

console.log("Compiling Kotlin plugin...");
execSync(`${gradlew} compileKotlin`, {
  cwd: jetbrainsDir,
  stdio: "inherit",
  shell: true,
});

console.log("");
console.log("JetBrains plugin build complete → apps/jetbrains/");
console.log("  Dev: cd apps/jetbrains && ./gradlew runIde");
console.log("  Requires system Bun on PATH (or QENEX_BUN_BIN).");
console.log("  Dev prefers repo apps/bridge; set QENEX_BRIDGE_ENTRY to override.");
