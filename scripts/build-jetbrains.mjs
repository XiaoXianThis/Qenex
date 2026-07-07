import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsDir = join(root, "apps", "jetbrains");
const binDir = join(jetbrainsDir, "bin");
const isWin = process.platform === "win32";
const binName = isWin ? "acp-to-agui.exe" : "acp-to-agui";
const releaseBin = join(root, "target", "release", binName);
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

console.log("Building Rust bridge...");
execSync("bun scripts/build-rust.mjs", { cwd: root, stdio: "inherit" });

if (!existsSync(releaseBin)) {
  throw new Error(`Rust binary not found: ${releaseBin}`);
}

mkdirSync(binDir, { recursive: true });
copyFileSync(releaseBin, join(binDir, binName));
if (!isWin) {
  chmodSync(join(binDir, binName), 0o755);
}
console.log(`Bridge binary copied to apps/jetbrains/bin/${binName}`);

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
console.log("  Verify: bun run verify:jetbrains");
console.log("  Debug:  cd apps/jetbrains && ./gradlew runIde");
console.log("  Package: bun run package:jetbrains");
