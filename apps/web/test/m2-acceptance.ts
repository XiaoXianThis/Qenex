/**
 * M2 web acceptance: production build contains Ask/Auto + approvals API markers.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");
const distDir = resolve(webRoot, "dist");

console.log("[m2] building @qenex/web…");
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
  ["contains approvals path", blob.includes("/approvals")],
  ["contains approvalMode", blob.includes("approvalMode")],
  ["contains Ask mode label", blob.includes("Ask")],
  ["contains Auto mode label", blob.includes("Auto")],
  ["contains 需要审批", blob.includes("需要审批")],
  ["contains 不再询问 or 允许", /不再询问|允许/.test(blob)],
  ["does not contain useAgUiRuntime", !blob.includes("useAgUiRuntime")],
  ["does not contain /v2/tasks approval path", !/\/v2\/tasks\/[^"'`]*\/approval/.test(blob)],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(ok ? `✓ ${label}` : `✗ ${label}`);
  if (!ok) failed = true;
}

if (failed) {
  process.exit(1);
}

const summary = {
  ok: true,
  phase: "M2",
  acceptance: "M2_WEB_BUILD_ACCEPTANCE_OK",
  at: new Date().toISOString(),
  repo: repoRoot,
  checks: Object.fromEntries(checks),
};
console.log(JSON.stringify(summary, null, 2));
console.log("M2_WEB_BUILD_ACCEPTANCE_OK");
