import { existsSync, readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageBunBridge } from "./lib/stage-bun-bridge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = join(root, "apps", "vscode");
const stageDir = join(vscodeDir, "bridge");

let failed = false;

const manager = readFileSync(join(vscodeDir, "src", "bridge-manager.ts"), "utf8");
if (manager.includes("acp-to-agui")) {
  console.error("FAIL  bridge-manager still references acp-to-agui");
  failed = true;
} else if (
  !manager.includes("QENEX_BRIDGE_PORT") ||
  !manager.includes("QENEX_CORS_ORIGINS")
) {
  console.error("FAIL  bridge-manager missing Bun Bridge env markers");
  failed = true;
} else {
  console.log("OK  bridge-manager spawns Bun Bridge");
}

const ignore = readFileSync(join(vscodeDir, ".vscodeignore"), "utf8");
if (
  ignore.includes("**/*.ts") &&
  !ignore.includes("!bridge/") &&
  !ignore.includes("!bridge/**")
) {
  console.error(
    "FAIL  .vscodeignore excludes **/*.ts without allowing bridge/",
  );
  failed = true;
} else {
  console.log("OK  .vscodeignore allows bridge TypeScript sources");
}

const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
if (bun.status === 0) {
  console.log(`OK  bun ${bun.stdout.trim()}`);
} else {
  console.error("MISSING  bun on PATH (required for VS Code Bridge)");
  failed = true;
}

console.log("Type-checking extension host...");
execSync("bunx tsc --noEmit -p tsconfig.json", {
  cwd: vscodeDir,
  stdio: "inherit",
});

console.log("Type-checking webview...");
execSync("bunx tsc --noEmit -p tsconfig.json", {
  cwd: join(vscodeDir, "webview"),
  stdio: "inherit",
});

console.log("[m9] Staging Bun Bridge into apps/vscode/bridge…");
stageBunBridge(stageDir, { includeNodeModules: true });

console.log("Building VS Code webview...");
execSync("bun run build", {
  cwd: join(vscodeDir, "webview"),
  stdio: "inherit",
});

console.log("Compiling extension host...");
execSync("node esbuild.mjs", { cwd: vscodeDir, stdio: "inherit" });

const required = [
  join(vscodeDir, "media", "index.html"),
  join(vscodeDir, "out", "extension.js"),
  join(stageDir, "src", "index.ts"),
  join(stageDir, "package.json"),
  join(stageDir, "node_modules", "ai", "package.json"),
  join(root, "apps", "bridge", "src", "index.ts"),
];

for (const file of required) {
  if (existsSync(file)) {
    console.log(`OK  ${file}`);
  } else {
    console.error(`MISSING  ${file}`);
    failed = true;
  }
}

if (existsSync(join(vscodeDir, "bin"))) {
  console.error("FAIL  apps/vscode/bin still present");
  failed = true;
} else {
  console.log("OK  no apps/vscode/bin");
}

if (failed) {
  process.exit(1);
}

console.log("");
console.log("verify:vscode passed");
