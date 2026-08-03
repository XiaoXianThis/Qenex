/**
 * M7 web acceptance: Host contract markers + Desktop Bun Bridge wiring present in repo.
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

console.log("[m7] checking Host / Desktop Bun Bridge wiring…");

const checks: Array<[string, boolean]> = [
  [
    "web-host getBridgeBaseUrl",
    read("apps/web/src/host/web-host.ts").includes("getBridgeBaseUrl"),
  ],
  [
    "tauri-host invoke cmd_get_bridge_url",
    read("apps/desktop/src/host/tauri-host.ts").includes("cmd_get_bridge_url"),
  ],
  [
    "desktop bridge.rs uses Bun",
    read("apps/desktop/src-tauri/src/bridge.rs").includes("QENEX_BRIDGE_PORT") &&
      !read("apps/desktop/src-tauri/src/bridge.rs").includes("acp-to-agui"),
  ],
  [
    "tauri.conf no externalBin",
    !read("apps/desktop/src-tauri/tauri.conf.json").includes("externalBin"),
  ],
  [
    "bridge cors module",
    existsSync(resolve(repoRoot, "apps/bridge/src/cors.ts")),
  ],
];

for (const [name, ok] of checks) {
  console.log(ok ? `OK  ${name}` : `FAIL  ${name}`);
  if (!ok) process.exit(1);
}

console.log("[m7] building @qenex/web…");
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

const webChecks: Array<[string, boolean]> = [
  ["contains /api/sessions", blob.includes("/api/sessions")],
  ["contains /api/chat", blob.includes("/api/chat")],
  ["contains /v2/agents", blob.includes("/v2/agents")],
  ["contains getBridgeBaseUrl path usage", /BridgeBaseUrl|bridge/i.test(blob)],
];

for (const [name, ok] of webChecks) {
  console.log(ok ? `OK  ${name}` : `FAIL  ${name}`);
  if (!ok) process.exit(1);
}

console.log("M7_WEB_BUILD_ACCEPTANCE_OK");
