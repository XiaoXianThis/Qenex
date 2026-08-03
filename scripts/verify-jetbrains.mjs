import { chmodSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsDir = join(root, "apps", "jetbrains");
const isWin = process.platform === "win32";
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

const required = [
  join(jetbrainsDir, "src", "main", "resources", "webview", "index.html"),
  join(jetbrainsDir, "src", "main", "resources", "META-INF", "plugin.xml"),
  join(jetbrainsDir, "src", "main", "kotlin", "com", "qenex", "BridgeProcessManager.kt"),
  join(jetbrainsDir, "src", "main", "kotlin", "com", "qenex", "QenexPanel.kt"),
  join(jetbrainsDir, "src", "main", "kotlin", "com", "qenex", "QenexToolWindowFactory.kt"),
];

let failed = false;

for (const file of required) {
  if (existsSync(file)) {
    console.log(`OK  ${file}`);
  } else {
    console.error(`MISSING  ${file}`);
    failed = true;
  }
}

console.log(
  "SKIP  apps/jetbrains/bin/acp-to-agui (Rust Bridge removed in v0.3.0; IDE Bun host = 0.3.x)",
);

console.log("Type-checking webview...");
execSync("bunx tsc --noEmit -p tsconfig.json", {
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

if (failed) {
  process.exit(1);
}

console.log("");
console.log("verify:jetbrains passed (Kotlin/webview only; Bridge spawn deferred to 0.3.x)");
