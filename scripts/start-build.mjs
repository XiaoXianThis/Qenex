/**
 * Start packaged Bun Bridge from `build/` (produced by `bun run build`).
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const bridgeEntry = join(buildDir, "bridge", "src", "index.ts");
const isWin = process.platform === "win32";
const starter = isWin ? join(buildDir, "start.ps1") : join(buildDir, "start.sh");

if (!existsSync(bridgeEntry)) {
  console.error(`Build output not found: ${bridgeEntry}`);
  console.error("Run `bun run build` first.");
  process.exit(1);
}

const child = isWin
  ? spawn("powershell", ["-NoProfile", "-File", starter], {
      cwd: buildDir,
      stdio: "inherit",
      shell: false,
    })
  : spawn(starter, [], {
      cwd: buildDir,
      stdio: "inherit",
      shell: false,
    });

child.on("exit", (code) => process.exit(code ?? 0));
