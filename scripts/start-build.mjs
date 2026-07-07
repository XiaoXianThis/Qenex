import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const isWin = process.platform === "win32";
const binName = isWin ? "acp-to-agui.exe" : "acp-to-agui";
const binPath = join(buildDir, binName);
const configPath = join(buildDir, "bridge.config.json");

if (!existsSync(binPath)) {
  console.error(`Build output not found: ${binPath}`);
  console.error("Run `bun run build` first.");
  process.exit(1);
}

const child = spawn(binPath, ["--config", configPath], {
  cwd: buildDir,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => process.exit(code ?? 0));
