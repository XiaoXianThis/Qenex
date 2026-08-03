import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = join(root, "apps", "vscode");

const required = [
  join(vscodeDir, "media", "index.html"),
  join(vscodeDir, "out", "extension.js"),
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

console.log(
  "SKIP  apps/vscode/bin/acp-to-agui (Rust Bridge removed in v0.3.0; IDE Bun host = 0.3.x)",
);

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
console.log("verify:vscode passed (webview/host only; Bridge spawn deferred to 0.3.x)");
