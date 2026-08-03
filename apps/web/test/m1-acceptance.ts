/**
 * M1 web acceptance: production build contains AI SDK runtime markers,
 * not AG-UI client strings.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");
const distDir = resolve(webRoot, "dist");

console.log("[m1] building @qenex/web…");
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
  ["contains /api/chat", blob.includes("/api/chat")],
  ["contains /api/sessions", blob.includes("/api/sessions")],
  ["contains useAISDKRuntime or AssistantChatTransport marker", /AssistantChatTransport|useAISDKRuntime|x-qenex-session-id/.test(blob)],
  ["contains session boot / error helpers", /ensureAisdkSession|formatBridgeError|x-qenex-session-id/.test(blob)],
  ["does not contain useAgUiRuntime", !blob.includes("useAgUiRuntime")],
  ["does not contain BridgeHttpAgent", !blob.includes("BridgeHttpAgent")],
  ["does not contain /ag-ui path as chat endpoint", !/["'`]\/ag-ui["'`]/.test(blob)],
  ["does not contain 还原到此消息前", !blob.includes("还原到此消息前")],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(ok ? `✓ ${label}` : `✗ ${label}`);
  if (!ok) failed = true;
}

if (failed) {
  process.exit(1);
}

// Write summary next to bridge artifacts for consistency
const summary = {
  ok: true,
  phase: "M1",
  acceptance: "M1_WEB_BUILD_ACCEPTANCE_OK",
  at: new Date().toISOString(),
  repo: repoRoot,
  checks: Object.fromEntries(checks),
};
console.log(JSON.stringify(summary, null, 2));
console.log("M1_WEB_BUILD_ACCEPTANCE_OK");
