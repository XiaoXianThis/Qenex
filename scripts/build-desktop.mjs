import { existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(root, "apps", "desktop");
const bridgeDir = join(root, "apps", "bridge");
const bridgeEntry = join(bridgeDir, "src", "index.ts");

const args = process.argv.slice(2);
const shouldPackage = args.includes("--package");
const allTargets = args.includes("--all-targets");
const targetArgIndex = args.indexOf("--target");
const explicitTargets =
  targetArgIndex >= 0
    ? args.slice(targetArgIndex + 1).filter((a) => !a.startsWith("--"))
    : [];

if (allTargets || explicitTargets.length > 0) {
  console.log(
    "Note: Desktop no longer builds per-target Rust sidecars (M7).",
  );
  console.log(
    "Bun Bridge source is bundled as Tauri resources; runtime uses system Bun.",
  );
}

function ensureBun() {
  const found = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (found.status !== 0) {
    throw new Error(
      "Bun not found on PATH. Install Bun before building Desktop.",
    );
  }
  console.log(`Bun ${found.stdout.trim()}`);
}

if (!existsSync(bridgeEntry)) {
  throw new Error(`Bun Bridge entry missing: ${bridgeEntry}`);
}

ensureBun();

console.log("Ensuring Bun Bridge dependencies...");
execSync("bun install", { cwd: bridgeDir, stdio: "inherit" });

console.log("Building desktop frontend...");
execSync("bun run build", { cwd: desktopDir, stdio: "inherit" });

ensureIcons(desktopDir);

if (shouldPackage) {
  console.log("Packaging Tauri app (bundles bridge/src + package.json)...");
  console.log(
    "Release still requires system Bun at runtime (embedding Bun = 0.3.x).",
  );
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
    console.warn(
      "Warning: app-icon.svg not found; run tauri icon manually before packaging",
    );
    return;
  }

  console.log("Generating Tauri icons from app-icon.svg...");
  try {
    execSync(`bun run tauri icon "${sourceIcon}"`, {
      cwd: desktopPath,
      stdio: "inherit",
    });
  } catch {
    console.warn(
      "Warning: failed to generate icons; packaging may require manual icon setup",
    );
  }
}
