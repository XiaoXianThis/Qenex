/**
 * CI / local release packaging → dist-artifacts/
 *
 * Usage:
 *   bun scripts/ci-release.mjs --platform <win32-x64|darwin-arm64|linux-x64> \
 *     [--version 0.3.1] \
 *     [--products server,vscode,jetbrains,desktop]
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { syncReleaseVersion } from "./lib/sync-release-version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distArtifactsDir = join(root, "dist-artifacts");
const isWin = process.platform === "win32";

const ALL_PRODUCTS = ["server", "vscode", "jetbrains", "desktop"];
const PLATFORMS = new Set(["win32-x64", "darwin-arm64", "linux-x64"]);

function parseArgs() {
  const args = process.argv.slice(2);
  const platformIndex = args.indexOf("--platform");
  if (platformIndex < 0 || !args[platformIndex + 1]) {
    console.error(
      "Usage: bun scripts/ci-release.mjs --platform <win32-x64|darwin-arm64|linux-x64> [--version X.Y.Z] [--products a,b]",
    );
    process.exit(1);
  }

  const platform = args[platformIndex + 1];
  if (!PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const versionIndex = args.indexOf("--version");
  const version =
    versionIndex >= 0 && args[versionIndex + 1]
      ? args[versionIndex + 1]
      : resolveVersion();

  const productsIndex = args.indexOf("--products");
  const products =
    productsIndex >= 0 && args[productsIndex + 1]
      ? args[productsIndex + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [...ALL_PRODUCTS];

  for (const p of products) {
    if (!ALL_PRODUCTS.includes(p)) {
      throw new Error(`Unknown product: ${p}`);
    }
  }

  return { platform, version, products };
}

function resolveVersion() {
  const ref = process.env.GITHUB_REF_NAME ?? "";
  if (ref.startsWith("v")) return ref.slice(1);
  const fromEnv = process.env.QENEX_RELEASE_VERSION?.trim();
  if (fromEnv) return fromEnv.replace(/^v/, "");
  return "0.3.0";
}

function run(command, options = {}) {
  console.log(`> ${command}`);
  execSync(command, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    ...options,
  });
}

/** Zip directory *contents* so start.sh / run.mjs land at zip root. */
function zipDirectory(sourceDir, outputZip) {
  if (existsSync(outputZip)) {
    rmSync(outputZip, { force: true });
  }

  if (isWin) {
    const source = sourceDir.replace(/'/g, "''");
    const dest = outputZip.replace(/'/g, "''");
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path '${source}\\*' -DestinationPath '${dest}' -Force"`,
    );
    return;
  }

  run(`cd "${sourceDir}" && zip -r "${outputZip}" .`);
}

function collectFiles(dir, extensions) {
  const results = [];

  function walk(current) {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      if (extensions.includes(ext)) results.push(fullPath);
    }
  }

  walk(dir);
  return results;
}

function writeManifest(platform, version, products) {
  const files = existsSync(distArtifactsDir)
    ? readdirSync(distArtifactsDir).filter((n) => n !== "manifest.json")
    : [];
  const manifest = {
    version,
    platform,
    products,
    createdAt: new Date().toISOString(),
    files,
  };
  writeFileSync(
    join(distArtifactsDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function packageServer(platform, version) {
  console.log("\n=== Building Bun Bridge server package ===");
  run("bun run build");

  const zipName = `qenex-server-${version}-${platform}.zip`;
  const zipPath = join(distArtifactsDir, zipName);
  zipDirectory(join(root, "build"), zipPath);
  console.log(`Server artifact: ${zipName}`);
}

function packageVscode(_platform, version) {
  console.log("\n=== Building VS Code extension ===");
  run("bun run package:vscode");

  const vsixDir = join(root, "apps", "vscode");
  const vsixFiles = readdirSync(vsixDir).filter((n) => n.endsWith(".vsix"));
  if (vsixFiles.length === 0) {
    throw new Error("No .vsix produced under apps/vscode/");
  }

  // Prefer versioned name matching package.json
  const preferred = vsixFiles.find((n) => n.includes(version)) ?? vsixFiles[0];
  const destName = `qenex-vscode-${version}.vsix`;
  copyFileSync(join(vsixDir, preferred), join(distArtifactsDir, destName));
  console.log(`VS Code artifact: ${destName}`);
}

function packageJetbrains(_platform, version) {
  console.log("\n=== Building JetBrains plugin ===");
  run("bun run package:jetbrains");

  const distDir = join(root, "apps", "jetbrains", "build", "distributions");
  if (!existsSync(distDir)) {
    throw new Error(`JetBrains distributions missing: ${distDir}`);
  }
  const zips = readdirSync(distDir).filter((n) => n.endsWith(".zip"));
  if (zips.length === 0) {
    throw new Error(`No JetBrains plugin zip under ${distDir}`);
  }

  const preferred =
    zips.find((n) => n.includes(version)) ??
    zips.sort((a, b) => {
      return (
        statSync(join(distDir, b)).mtimeMs - statSync(join(distDir, a)).mtimeMs
      );
    })[0];

  const destName = `qenex-jetbrains-${version}.zip`;
  copyFileSync(join(distDir, preferred), join(distArtifactsDir, destName));
  console.log(`JetBrains artifact: ${destName}`);
}

function copyDesktopBundles(platform, version) {
  const bundleDir = join(
    root,
    "apps",
    "desktop",
    "src-tauri",
    "target",
    "release",
    "bundle",
  );
  const installers = collectFiles(bundleDir, [
    ".exe",
    ".msi",
    ".dmg",
    ".deb",
    ".appimage",
    ".rpm",
  ]);

  if (installers.length === 0) {
    throw new Error(`No desktop installers found under ${bundleDir}`);
  }

  for (const installer of installers) {
    const relativePath = relative(bundleDir, installer).replace(/\\/g, "/");
    const prefixedName = `qenex-desktop-${version}-${platform}-${relativePath.replace(/\//g, "-")}`;
    const dest = join(distArtifactsDir, prefixedName);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(installer, dest);
    console.log(`Desktop artifact: ${prefixedName}`);
  }
}

function packageDesktop(platform, version) {
  console.log("\n=== Building Desktop app ===");
  run("bun run package:desktop");
  copyDesktopBundles(platform, version);
}

function main() {
  const { platform, version, products } = parseArgs();

  console.log(
    `CI release build: version=${version}, platform=${platform}, products=${products.join(",")}`,
  );

  syncReleaseVersion(root, version);

  rmSync(distArtifactsDir, { recursive: true, force: true });
  mkdirSync(distArtifactsDir, { recursive: true });

  if (products.includes("server")) packageServer(platform, version);
  if (products.includes("vscode")) packageVscode(platform, version);
  if (products.includes("jetbrains")) packageJetbrains(platform, version);
  if (products.includes("desktop")) packageDesktop(platform, version);

  writeManifest(platform, version, products);

  const artifacts = readdirSync(distArtifactsDir)
    .filter((n) => n !== "manifest.json")
    .map((name) => {
      const fullPath = join(distArtifactsDir, name);
      const sizeMb = (statSync(fullPath).size / (1024 * 1024)).toFixed(2);
      return `  - ${name} (${sizeMb} MB)`;
    })
    .join("\n");

  console.log("\nRelease artifacts:");
  console.log(artifacts || "  (none)");
  console.log(`\nDone → ${distArtifactsDir}`);
}

main();
