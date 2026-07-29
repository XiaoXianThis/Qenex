import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "crates", "bridge", "Cargo.toml");
const tauriDir = join(root, "apps", "desktop", "src-tauri");
const binariesDir = join(tauriDir, "binaries");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const rustc = spawnSync("rustc", ["-vV"], {
  cwd: root,
  encoding: "utf8",
});
if (rustc.error) {
  throw rustc.error;
}
if (rustc.status !== 0) {
  process.stderr.write(rustc.stderr);
  process.exit(rustc.status ?? 1);
}

const hostTriple = rustc.stdout
  .split("\n")
  .find((line) => line.startsWith("host:"))
  ?.slice("host:".length)
  .trim();
if (!hostTriple) {
  throw new Error("Could not determine the Rust host target");
}

const isWindows = hostTriple.includes("windows");
const executableName = isWindows ? "acp-to-agui.exe" : "acp-to-agui";
const source = join(root, "target", "debug", executableName);
const sidecarName = isWindows
  ? `acp-to-agui-${hostTriple}.exe`
  : `acp-to-agui-${hostTriple}`;
const destination = join(binariesDir, sidecarName);
const stagedDestination = join(
  tauriDir,
  "target",
  "debug",
  executableName,
);

console.log(`Building current desktop bridge for ${hostTriple}...`);
run("cargo", [
  "build",
  "--manifest-path",
  manifest,
  "--features",
  "server",
  "--bin",
  "acp-to-agui",
]);

mkdirSync(binariesDir, { recursive: true });
copyFileSync(source, destination);
if (!isWindows) {
  chmodSync(destination, 0o755);
}
console.log(`Desktop sidecar synced → ${destination}`);

// Tauri stages external binaries under its own target/debug directory. Cargo
// does not track the source sidecar as an input, so an existing staged copy can
// otherwise remain stale even after binaries/ is refreshed.
mkdirSync(dirname(stagedDestination), { recursive: true });
copyFileSync(source, stagedDestination);
if (!isWindows) {
  chmodSync(stagedDestination, 0o755);
}
console.log(`Tauri debug sidecar synced → ${stagedDestination}`);

run("bun", ["run", "--filter", "@qenex/desktop", "tauri:dev"]);
