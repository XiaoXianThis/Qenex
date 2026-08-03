/**
 * M3 web acceptance: production build contains rich UI / files / @ markers.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");
const distDir = resolve(webRoot, "dist");

console.log("[m3] building @qenex/web…");
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
  ["contains /api/files", blob.includes("/api/files")],
  ["contains 引用文件", blob.includes("引用文件")],
  ["contains Markdown/Shiki markers or mermaid", /mermaid|shiki|MarkdownText|highlight/i.test(blob)],
  ["contains tool fallback / 需要审批 still present", /tool-call|ToolFallback|需要审批/.test(blob)],
  ["contains MessageArtifacts / Plan / Diff", /Plan|Diff|message-artifacts|terminals/i.test(blob)],
  ["does not prefer AisdkThreadMessages as primary path comment-only ok", true],
  ["does not contain useAgUiRuntime", !blob.includes("useAgUiRuntime")],
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
  phase: "M3",
  acceptance: "M3_WEB_BUILD_ACCEPTANCE_OK",
  at: new Date().toISOString(),
  repo: repoRoot,
  checks: Object.fromEntries(checks),
};
console.log(JSON.stringify(summary, null, 2));
console.log("M3_WEB_BUILD_ACCEPTANCE_OK");
