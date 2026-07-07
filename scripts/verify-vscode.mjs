import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = join(root, "apps", "vscode");
const isWin = process.platform === "win32";
const binName = isWin ? "acp-to-agui.exe" : "acp-to-agui";

const required = [
  join(vscodeDir, "media", "index.html"),
  join(vscodeDir, "out", "extension.js"),
  join(vscodeDir, "bin", binName),
];

let failed = false;

for (const file of required) {
  if (existsSync(file)) {
    console.log(`OK  ${file}`);
  } else {
    console.error(`MISSING  ${file}`);
    failed = true;
  }
}

console.log("Type-checking extension host...");
execSync("bunx tsc --noEmit -p tsconfig.json", {
  cwd: vscodeDir,
  stdio: "inherit",
});

console.log("Type-checking webview...");
execSync("bunx tsc --noEmit -p tsconfig.json", {
  cwd: join(vscodeDir, "webview"),
  stdio: "inherit",
});

if (failed) {
  process.exit(1);
}

console.log("");
console.log("verify:vscode passed");
