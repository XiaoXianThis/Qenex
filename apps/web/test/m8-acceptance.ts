/**
 * M8 web acceptance: no AG-UI / Rust Bridge / checkpoint UI in build.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

console.log("[m8] repo gates…");
const gates: Array<[string, boolean]> = [
  ["no crates/bridge", !existsSync(resolve(repoRoot, "crates/bridge"))],
  ["no root Cargo.toml", !existsSync(resolve(repoRoot, "Cargo.toml"))],
  ["no acp-to-agui/", !existsSync(resolve(repoRoot, "acp-to-agui"))],
  ["no dev:rust script", !read("package.json").includes("dev:rust")],
  ["CHANGELOG v0.3.0", /v0\.3\.0/.test(read("CHANGELOG.md"))],
];

for (const [name, ok] of gates) {
  console.log(ok ? `OK  ${name}` : `FAIL  ${name}`);
  if (!ok) process.exit(1);
}

console.log("[m8] building @qenex/web…");
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

const distDir = resolve(webRoot, "dist");
const assets = readdirSync(resolve(distDir, "assets")).filter((f) =>
  f.endsWith(".js"),
);
const blob = assets
  .map((f) => readFileSync(resolve(distDir, "assets", f), "utf8"))
  .join("\n");

const checks: Array<[string, boolean]> = [
  ["no @ag-ui/client", !blob.includes("@ag-ui/client")],
  ["no react-ag-ui", !blob.includes("react-ag-ui")],
  ["no useAgUiRuntime", !blob.includes("useAgUiRuntime")],
  ["no BridgeHttpAgent", !blob.includes("BridgeHttpAgent")],
  ["no /ag-ui path", !blob.includes('"/ag-ui"') && !blob.includes("'/ag-ui'")],
  ["has /api/chat", blob.includes("/api/chat")],
  ["has /v2/agents", blob.includes("/v2/agents")],
];

for (const [name, ok] of checks) {
  console.log(ok ? `OK  ${name}` : `FAIL  ${name}`);
  if (!ok) process.exit(1);
}

console.log("M8_WEB_BUILD_ACCEPTANCE_OK");
