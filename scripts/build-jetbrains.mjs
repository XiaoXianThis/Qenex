/**
 * JetBrains plugin build (0.3.0): webview + Kotlin only.
 * Rust acp-to-agui sidecar removed; Bun Bridge host migration is 0.3.x.
 */
import { chmodSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsDir = join(root, "apps", "jetbrains");
const isWin = process.platform === "win32";
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

console.log(
  "[m8] Skipping Rust acp-to-agui binary (removed). IDE Bun Bridge = 0.3.x.",
);

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
console.log("  Note: Bridge spawn still expects Bun migration (0.3.x).");
