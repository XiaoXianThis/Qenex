/**
 * VS Code extension build (0.3.0): webview + host only.
 * Rust acp-to-agui sidecar removed; Bun Bridge host migration is 0.3.x
 * (see apps/bridge/M7.md IDE checklist). Packaged IDE is not a v0.3.0 gate.
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = join(root, "apps", "vscode");

console.log(
  "[m8] Skipping Rust acp-to-agui binary (removed). IDE Bun Bridge = 0.3.x.",
);

console.log("Building VS Code webview...");
execSync("bun run build", {
  cwd: join(vscodeDir, "webview"),
  stdio: "inherit",
});

console.log("Compiling extension host...");
execSync("node esbuild.mjs", { cwd: vscodeDir, stdio: "inherit" });

console.log("");
console.log("VS Code extension build complete → apps/vscode/");
console.log("  Note: Bridge spawn still expects Bun migration (0.3.x).");
console.log("  Package: bun run package:vscode (may lack working Bridge until 0.3.x)");
