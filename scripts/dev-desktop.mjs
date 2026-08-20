import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureManagedBun } from "./lib/ensure-bun.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeEntry = join(root, "apps", "bridge", "src", "index.ts");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const bun = await ensureManagedBun({
  onProgress: (msg) => console.log(`[qenex] ${msg}`),
});
if (!bun) {
  console.error(
    "Bun not found. Install Bun (https://bun.sh) or set QENEX_BUN_BIN.",
  );
  process.exit(1);
}

if (!existsSync(bridgeEntry)) {
  console.error(`Bun Bridge entry missing: ${bridgeEntry}`);
  process.exit(1);
}

console.log(`Desktop Bun Bridge entry: ${bridgeEntry}`);
console.log(`Using Bun: ${bun}`);
run(bun, ["run", "--filter", "@qenex/desktop", "tauri:dev"]);
