import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(root, "apps", "desktop");
const tauriDir = join(desktopDir, "src-tauri");

function getHostTarget() {
  return execSync("rustc -vV", { encoding: "utf8" })
    .split("\n")
    .find((line) => line.startsWith("host:"))
    ?.slice("host:".length)
    .trim();
}

const hostTriple = getHostTarget();
const isWin = hostTriple?.includes("windows");
const sidecarName = isWin
  ? `acp-to-agui-${hostTriple}.exe`
  : `acp-to-agui-${hostTriple}`;

const required = [
  join(desktopDir, "dist", "index.html"),
  join(desktopDir, "bridge.config.json"),
  join(tauriDir, "binaries", sidecarName),
  join(tauriDir, "tauri.conf.json"),
  join(tauriDir, "src", "lib.rs"),
  join(desktopDir, "src", "host", "tauri-host.ts"),
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

console.log("Type-checking desktop frontend...");
execSync("bunx tsc --noEmit -p tsconfig.app.json", {
  cwd: desktopDir,
  stdio: "inherit",
});

console.log("Checking Tauri Rust crate...");
execSync("cargo check", {
  cwd: tauriDir,
  stdio: "inherit",
});

if (failed) {
  process.exit(1);
}

console.log("");
console.log("verify:desktop passed");
