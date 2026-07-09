import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(root, "apps", "desktop");
const binariesDir = join(desktopDir, "src-tauri", "binaries");
const manifest = join(root, "crates", "bridge", "Cargo.toml");
const isWin = process.platform === "win32";

const ALL_TARGETS = [
  "x86_64-pc-windows-msvc",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-unknown-linux-gnu",
];

const args = process.argv.slice(2);
const allTargets = args.includes("--all-targets");
const shouldPackage = args.includes("--package");
const targetArgIndex = args.indexOf("--target");
const explicitTargets =
  targetArgIndex >= 0 ? args.slice(targetArgIndex + 1).filter((a) => !a.startsWith("--")) : [];

function getHostTarget() {
  return execSync("rustc -vV", { encoding: "utf8" })
    .split("\n")
    .find((line) => line.startsWith("host:"))
    ?.slice("host:".length)
    .trim();
}

function sidecarName(triple) {
  const base = `acp-to-agui-${triple}`;
  return triple.includes("windows") ? `${base}.exe` : base;
}

function buildTarget(triple) {
  const binName = triple.includes("windows") ? "acp-to-agui.exe" : "acp-to-agui";
  // `cargo --target` always writes under target/<triple>/, even for the host triple.
  const releaseBin = join(root, "target", triple, "release", binName);

  console.log(`Building bridge for ${triple}...`);
  try {
    execSync(
      `cargo build --release --manifest-path "${manifest}" --features server --bin acp-to-agui --target ${triple}`,
      { cwd: root, stdio: "inherit" },
    );
  } catch {
    throw new Error(
      `Failed to build for ${triple}. Install the target with: rustup target add ${triple}`,
    );
  }

  if (!existsSync(releaseBin)) {
    throw new Error(`Rust build failed: ${releaseBin} not found`);
  }

  mkdirSync(binariesDir, { recursive: true });
  const dest = join(binariesDir, sidecarName(triple));
  copyFileSync(releaseBin, dest);
  if (!isWin) {
    chmodSync(dest, 0o755);
  }
  console.log(`Sidecar copied to ${dest}`);
}

const hostTarget = getHostTarget();
const targets = explicitTargets.length
  ? explicitTargets
  : allTargets
    ? ALL_TARGETS
    : [hostTarget];

console.log(`Sidecar targets: ${targets.join(", ")}`);

for (const triple of targets) {
  buildTarget(triple);
}

console.log("Building desktop frontend...");
execSync("bun run build", { cwd: desktopDir, stdio: "inherit" });

ensureIcons(desktopDir);

if (shouldPackage) {
  console.log("Packaging Tauri app...");
  execSync("bun run tauri:build", { cwd: desktopDir, stdio: "inherit" });
}

console.log("");
console.log("Desktop build complete → apps/desktop/");
console.log("  Dev:   bun run dev:desktop");
console.log("  Verify: bun run verify:desktop");

function ensureIcons(desktopPath) {
  const iconsDir = join(desktopPath, "src-tauri", "icons");
  const iconIco = join(iconsDir, "icon.ico");
  if (existsSync(iconIco)) {
    return;
  }

  const sourceIcon = join(desktopPath, "app-icon.svg");
  if (!existsSync(sourceIcon)) {
    console.warn("Warning: app-icon.svg not found; run tauri icon manually before packaging");
    return;
  }

  console.log("Generating Tauri icons from app-icon.svg...");
  try {
    execSync(`bun run tauri icon "${sourceIcon}"`, {
      cwd: desktopPath,
      stdio: "inherit",
    });
  } catch {
    console.warn("Warning: failed to generate icons; packaging may require manual icon setup");
  }
}
