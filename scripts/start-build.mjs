/**
 * Start packaged Bun Bridge + Web from `build/` (produced by `bun run build`).
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const runJs = join(buildDir, "run.mjs");
const bridgeEntry = join(buildDir, "bridge", "index.js");

if (!existsSync(bridgeEntry)) {
  console.error(`Build output not found: ${bridgeEntry}`);
  console.error("Run `bun run build` first.");
  process.exit(1);
}

const entry = existsSync(runJs) ? runJs : bridgeEntry;
const child = spawn("bun", [entry], {
  cwd: buildDir,
  stdio: "inherit",
  env: {
    ...process.env,
    QENEX_BRIDGE_HOST: process.env.QENEX_BRIDGE_HOST || "127.0.0.1",
    QENEX_BRIDGE_PORT: process.env.QENEX_BRIDGE_PORT || "8000",
    QENEX_WEB_PORT: process.env.QENEX_WEB_PORT || "3000",
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
