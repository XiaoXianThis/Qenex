/**
 * Build Web + Bun Bridge package into `build/` (no Rust Bridge).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const bridgeSrc = join(root, "apps", "bridge");
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
mkdirSync(stagedBridge, { recursive: true });
cpSync(join(bridgeSrc, "src"), join(stagedBridge, "src"), { recursive: true });
cpSync(join(bridgeSrc, "package.json"), join(stagedBridge, "package.json"));
execSync("bun install --production", { cwd: stagedBridge, stdio: "inherit" });

writeFileSync(
  join(buildDir, "start.ps1"),
  `$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error "Bun is required. Install from https://bun.sh"
}
$env:QENEX_BRIDGE_HOST = if ($env:QENEX_BRIDGE_HOST) { $env:QENEX_BRIDGE_HOST } else { "127.0.0.1" }
$env:QENEX_BRIDGE_PORT = if ($env:QENEX_BRIDGE_PORT) { $env:QENEX_BRIDGE_PORT } else { "8000" }
Set-Location .\\bridge
& bun .\\src\\index.ts
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
export QENEX_BRIDGE_HOST="\${QENEX_BRIDGE_HOST:-127.0.0.1}"
export QENEX_BRIDGE_PORT="\${QENEX_BRIDGE_PORT:-8000}"
cd bridge
exec bun ./src/index.ts
`,
);

if (!isWin) {
  execSync(`chmod +x "${join(buildDir, "start.sh")}"`, { cwd: root });
}

writeFileSync(
  join(buildDir, "README.txt"),
  `Qenex v0.3 build output (Bun Bridge)

Requires system Bun (https://bun.sh).

Run:
  Windows:  .\\start.ps1
  Unix:     ./start.sh

Then open the Web UI separately (dev: bun run dev:web) or serve build/web/.
Bridge listens on http://127.0.0.1:8000 by default.

Contents:
  bridge/     Bun Bridge source + production deps
  web/        Static frontend
  start.sh / start.ps1
`,
);

console.log("");
console.log("Build complete → build/");
console.log(`  Run: ${isWin ? "build\\\\start.ps1" : "build/start.sh"}`);
console.log("  Bridge: http://127.0.0.1:8000");
