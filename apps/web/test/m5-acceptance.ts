/**
 * M5 web acceptance: build contains session config REST markers, not AG-UI mode sync.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");
const distDir = resolve(webRoot, "dist");

console.log("[m5] building @qenex/web…");
const build = spawnSync("bun", ["run", "build"], {
  cwd: webRoot,
  encoding: "utf8",
  env: process.env,
});
if (build.status !== 0) {
  console.error(build.stdout);
  console.error(build.stderr);
  process.exit(build.status ?? 1);
}

if (!existsSync(distDir)) {
  console.error("dist/ missing after build");
  process.exit(1);
}

const assets = readdirSync(resolve(distDir, "assets")).filter((f) =>
  f.endsWith(".js"),
);
const blob = assets
  .map((f) => readFileSync(resolve(distDir, "assets", f), "utf8"))
  .join("\n");

const checks: Array<[string, boolean]> = [
  ["contains /config path", blob.includes("/config")],
  ["contains /mode or set mode", /\/mode|setAisdkSessionMode|modeId/.test(blob)],
  ["contains SessionConfigBar / modes UI", /SessionConfig|modes|formatModeLabel/.test(blob)],
  ["does not contain ModeSyncBridge", !blob.includes("ModeSyncBridge")],
  ["does not contain agent:mode_update", !blob.includes("agent:mode_update")],
  ["does not contain useAgUiRuntime", !blob.includes("useAgUiRuntime")],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(ok ? `✓ ${label}` : `✗ ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);

console.log(
  JSON.stringify(
    {
      ok: true,
      phase: "M5",
      acceptance: "M5_WEB_BUILD_ACCEPTANCE_OK",
      at: new Date().toISOString(),
      repo: repoRoot,
      checks: Object.fromEntries(checks),
    },
    null,
    2,
  ),
);
console.log("M5_WEB_BUILD_ACCEPTANCE_OK");
