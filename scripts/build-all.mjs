/**
 * Build Web + Bun Bridge package into `build/` (no Rust Bridge).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageBunBridge } from "./lib/stage-bun-bridge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const isWin = process.platform === "win32";

console.log("Cleaning build/...");
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

console.log("Building web frontend...");
execSync("bun scripts/build-web.mjs", { cwd: root, stdio: "inherit" });

const webOut = join(root, "apps", "web", "dist");
if (!existsSync(webOut)) {
  throw new Error(`Web dist missing: ${webOut}`);
}
cpSync(webOut, join(buildDir, "web"), { recursive: true });

console.log("Staging Bun Bridge...");
const stagedBridge = join(buildDir, "bridge");
stageBunBridge(stagedBridge);

cpSync(
  join(root, "scripts", "templates", "server-run.mjs"),
  join(buildDir, "run.mjs"),
);

writeFileSync(
  join(buildDir, "start.ps1"),
  `$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error "Bun is required. Install from https://bun.sh"
}
& bun .\\run.mjs
`,
);

writeFileSync(
  join(buildDir, "start.sh"),
  `#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install from https://bun.sh" >&2
  exit 1
fi
exec bun ./run.mjs
`,
);

if (!isWin) {
  execSync(`chmod +x "${join(buildDir, "start.sh")}"`, { cwd: root });
}

writeFileSync(
  join(buildDir, "README.txt"),
  `Qenex server package (Bun Bridge + Web)

Requires system Bun (https://bun.sh).

Run:
  Windows:  .\\start.ps1
  Unix:     ./start.sh

Then open http://127.0.0.1:3000
  - Web UI on :3000 (proxies /api /v2 /health to Bridge)
  - Bridge on :8000

Env overrides:
  QENEX_BRIDGE_HOST / QENEX_BRIDGE_PORT / QENEX_WEB_PORT

Contents:
  bridge/   Prebundled Bun Bridge runtime
  web/      Static frontend
  run.mjs   Integrated runner
  start.sh / start.ps1
`,
);

console.log("");
console.log("Build complete → build/");
console.log(`  Run: ${isWin ? "build\\\\start.ps1" : "build/start.sh"}`);
console.log("  Web: http://127.0.0.1:3000  Bridge: http://127.0.0.1:8000");
