import { existsSync, readdirSync, statSync } from "node:fs";
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
const sidecarPath = join(tauriDir, "binaries", sidecarName);
const stagedDebugSidecarPath = join(
  tauriDir,
  "target",
  "debug",
  isWin ? "acp-to-agui.exe" : "acp-to-agui",
);

let failed = false;

for (const file of required) {
  if (existsSync(file)) {
    console.log(`OK  ${file}`);
  } else {
    console.error(`MISSING  ${file}`);
    failed = true;
  }
}

function newestRustSourceMtime(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestRustSourceMtime(path));
    } else if (entry.name.endsWith(".rs")) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

if (existsSync(sidecarPath)) {
  const bridgeSourceMtime = Math.max(
    newestRustSourceMtime(join(root, "crates", "bridge", "src")),
    statSync(join(root, "crates", "bridge", "Cargo.toml")).mtimeMs,
  );
  const sidecarMtime = statSync(sidecarPath).mtimeMs;
  if (sidecarMtime < bridgeSourceMtime) {
    console.error(
      `STALE  ${sidecarPath}\nRun "bun run dev:desktop" or "bun run build:desktop" to rebuild it.`,
    );
    failed = true;
  } else {
    console.log(`FRESH  ${sidecarPath}`);
  }

  if (
    existsSync(stagedDebugSidecarPath) &&
    statSync(stagedDebugSidecarPath).mtimeMs < sidecarMtime
  ) {
    console.error(
      `STALE  ${stagedDebugSidecarPath}\nRun "bun run dev:desktop" to refresh Tauri's staged debug sidecar.`,
    );
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
