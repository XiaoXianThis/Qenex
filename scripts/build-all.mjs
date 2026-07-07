import { rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const isWin = process.platform === "win32";
const binName = isWin ? "acp-to-agui.exe" : "acp-to-agui";

console.log("Cleaning build/...");
rmSync(buildDir, { recursive: true, force: true });

execSync("bun scripts/build-web.mjs", { cwd: root, stdio: "inherit" });
execSync("bun scripts/build-rust.mjs", { cwd: root, stdio: "inherit" });

writeFileSync(
  join(buildDir, "start.ps1"),
  `$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
& ".\\${binName}" --config bridge.config.json
`,
);

writeFileSync(
  join(buildDir, "start.sh"),
  `#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
exec ./${binName} --config bridge.config.json
`,
);

if (!isWin) {
  execSync(`chmod +x "${join(buildDir, "start.sh")}"`, { cwd: root });
}

writeFileSync(
  join(buildDir, "README.txt"),
  `Qenex build output

Run:
  Windows:  .\\start.ps1   or   .\\${binName} --config bridge.config.json
  Unix:     ./start.sh     or   ./${binName} --config bridge.config.json

Then open http://localhost:8000

Contents:
  ${binName}         Bridge server (UI embedded + API)
  bridge.config.json Server configuration
  web/               Static frontend copy (reference; UI is embedded in binary)
`,
);

console.log("");
console.log("Build complete → build/");
console.log(`  Run: ${isWin ? "build\\start.ps1" : "build/start.sh"}`);
console.log("  Open: http://localhost:8000");
