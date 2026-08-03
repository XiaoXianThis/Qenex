/**
 * M4 web acceptance: production build contains history / sessionId markers.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");
const distDir = resolve(webRoot, "dist");

console.log("[m4] building @qenex/web…");
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
  ["contains /messages history path", blob.includes("/messages")],
  ["contains listAisdkSessionMessages or messages fetch", /\/messages|listAisdkSessionMessages/.test(blob)],
  ["contains sessionId tab field usage", /sessionId/.test(blob)],
  ["does not contain useAgUiRuntime", !blob.includes("useAgUiRuntime")],
  ["does not contain replay-agui", !blob.includes("replay-agui")],
  ["does not contain tasks.db", !blob.includes("tasks.db")],
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
  phase: "M4",
  acceptance: "M4_WEB_BUILD_ACCEPTANCE_OK",
  at: new Date().toISOString(),
  repo: repoRoot,
  checks: Object.fromEntries(checks),
};
console.log(JSON.stringify(summary, null, 2));
console.log("M4_WEB_BUILD_ACCEPTANCE_OK");
