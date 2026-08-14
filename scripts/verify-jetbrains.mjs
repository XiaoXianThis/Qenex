import {
  chmodSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageBunBridge } from "./lib/stage-bun-bridge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsDir = join(root, "apps", "jetbrains");
const stageDir = join(jetbrainsDir, "build", "qenex-bridge-stage");
const isWin = process.platform === "win32";
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

const requiredBeforeBuild = [
  join(jetbrainsDir, "src", "main", "resources", "META-INF", "plugin.xml"),
  join(jetbrainsDir, "src", "main", "kotlin", "com", "qenex", "BridgeProcessManager.kt"),
  join(jetbrainsDir, "src", "main", "kotlin", "com", "qenex", "QenexPanel.kt"),
  join(jetbrainsDir, "src", "main", "kotlin", "com", "qenex", "QenexToolWindowFactory.kt"),
  join(root, "apps", "bridge", "src", "index.ts"),
];

let failed = false;

for (const file of requiredBeforeBuild) {
  if (existsSync(file)) {
    console.log(`OK  ${file}`);
  } else {
    console.error(`MISSING  ${file}`);
    failed = true;
  }
}

const manager = readFileSync(
  join(jetbrainsDir, "src", "main", "kotlin", "com", "qenex", "BridgeProcessManager.kt"),
  "utf8",
);
if (manager.includes("acp-to-agui")) {
  console.error("FAIL  BridgeProcessManager still references acp-to-agui");
  failed = true;
} else if (!manager.includes("QENEX_BRIDGE_PORT") || !manager.includes("QENEX_CORS_ORIGINS")) {
  console.error("FAIL  BridgeProcessManager missing Bun Bridge env markers");
  failed = true;
} else if (!manager.includes("findRepoBridgeEntry")) {
  console.error("FAIL  BridgeProcessManager missing findRepoBridgeEntry (dev-first)");
  failed = true;
} else {
  console.log("OK  BridgeProcessManager spawns Bun Bridge (dev-first)");
}

const gradle = readFileSync(join(jetbrainsDir, "build.gradle.kts"), "utf8");
if (gradle.includes("qenex/bin") || gradle.includes('from("bin")')) {
  console.error("FAIL  build.gradle.kts still packages Rust bin/");
  failed = true;
} else if (!gradle.includes("qenex/bridge")) {
  console.error("FAIL  build.gradle.kts missing qenex/bridge packaging");
  failed = true;
} else {
  console.log("OK  build.gradle.kts packages qenex/bridge (no Rust bin)");
}

const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
if (bun.status === 0) {
  console.log(`OK  bun ${bun.stdout.trim()}`);
} else {
  console.error("MISSING  bun on PATH (required for JetBrains Bridge)");
  failed = true;
}

console.log("Type-checking webview...");
execSync("bunx tsc --noEmit -p tsconfig.json", {
  cwd: join(jetbrainsDir, "webview"),
  stdio: "inherit",
});

console.log("Building JetBrains webview (resources)…");
execSync("bun run build", {
  cwd: join(jetbrainsDir, "webview"),
  stdio: "inherit",
});

const webviewHtml = join(
  jetbrainsDir,
  "src",
  "main",
  "resources",
  "webview",
  "index.html",
);
if (existsSync(webviewHtml)) {
  console.log(`OK  ${webviewHtml}`);
} else {
  console.error(`MISSING  ${webviewHtml}`);
  failed = true;
}

console.log("[m9] Staging Bun Bridge for processResources…");
stageBunBridge(stageDir);

if (!isWin) {
  chmodSync(join(jetbrainsDir, "gradlew"), 0o755);
}

console.log("processResources + compileKotlin…");
execSync(`${gradlew} processResources compileKotlin`, {
  cwd: jetbrainsDir,
  stdio: "inherit",
  shell: true,
});

const bundledIndex = join(
  jetbrainsDir,
  "build",
  "resources",
  "main",
  "qenex",
  "bridge",
  "index.js",
);
const resourcePkg = join(
  jetbrainsDir,
  "build",
  "resources",
  "main",
  "qenex",
  "bridge",
  "package.json",
);
const rustBin = join(
  jetbrainsDir,
  "build",
  "resources",
  "main",
  "qenex",
  "bin",
);

if (existsSync(bundledIndex) && existsSync(resourcePkg)) {
  console.log(`OK  packaged resource ${bundledIndex}`);
} else {
  console.error("MISSING  processResources output qenex/bridge");
  failed = true;
}

if (existsSync(rustBin)) {
  console.error("FAIL  qenex/bin still present in resources");
  failed = true;
} else {
  console.log("OK  no qenex/bin in resources");
}

if (failed) {
  process.exit(1);
}

console.log("");
console.log("verify:jetbrains passed");
