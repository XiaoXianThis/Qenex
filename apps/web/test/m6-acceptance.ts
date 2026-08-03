/**
 * M6 web acceptance: build contains multi-agent REST markers.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");
const distDir = resolve(webRoot, "dist");

console.log("[m6] building @qenex/web…");
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
  ["contains /v2/agents", blob.includes("/v2/agents")],
  ["contains ensure-ready", blob.includes("ensure-ready")],
  ["contains agentId create path", /agentId/.test(blob)],
  ["contains AgentSettings / registry UI", /AgentSettings|registry/.test(blob)],
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
      phase: "M6",
      acceptance: "M6_WEB_BUILD_ACCEPTANCE_OK",
      at: new Date().toISOString(),
      repo: repoRoot,
      checks: Object.fromEntries(checks),
    },
    null,
    2,
  ),
);
console.log("M6_WEB_BUILD_ACCEPTANCE_OK");
