import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = join(root, "apps", "vscode");
const binDir = join(vscodeDir, "bin");
const isWin = process.platform === "win32";
const binName = isWin ? "acp-to-agui.exe" : "acp-to-agui";
const releaseBin = join(root, "target", "release", binName);

console.log("Building Rust bridge...");
execSync("bun scripts/build-rust.mjs", { cwd: root, stdio: "inherit" });

if (!existsSync(releaseBin)) {
  throw new Error(`Rust binary not found: ${releaseBin}`);
}

mkdirSync(binDir, { recursive: true });
copyFileSync(releaseBin, join(binDir, binName));
if (!isWin) {
  chmodSync(join(binDir, binName), 0o755);
}
console.log(`Bridge binary copied to apps/vscode/bin/${binName}`);

console.log("Building VS Code webview...");
execSync("bun run build", {
  cwd: join(vscodeDir, "webview"),
  stdio: "inherit",
});

console.log("Compiling extension host...");
execSync("node esbuild.mjs", { cwd: vscodeDir, stdio: "inherit" });

console.log("");
console.log("VS Code extension build complete → apps/vscode/");
console.log("  F5: open apps/vscode in VS Code and launch 'Run Qenex Extension'");
console.log("  Package: bun run package:vscode");
