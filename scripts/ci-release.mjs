import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distArtifactsDir = join(root, "dist-artifacts");
const isWin = process.platform === "win32";

function parseArgs() {
  const args = process.argv.slice(2);
  const platformIndex = args.indexOf("--platform");
  if (platformIndex < 0 || !args[platformIndex + 1]) {
    console.error("Usage: node scripts/ci-release.mjs --platform <win32-x64|darwin-arm64|linux-x64>");
    process.exit(1);
  }

  const versionIndex = args.indexOf("--version");
  const version =
    versionIndex >= 0 && args[versionIndex + 1]
      ? args[versionIndex + 1]
      : resolveVersion();

  return {
    platform: args[platformIndex + 1],
    version,
  };
}

function resolveVersion() {
  const ref = process.env.GITHUB_REF_NAME ?? "";
  if (ref.startsWith("v")) {
    return ref.slice(1);
  }
  return "0.3.0";
}

function run(command, options = {}) {
  console.log(`> ${command}`);
  execSync(command, { cwd: root, stdio: "inherit", ...options });
}

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

  const parent = dirname(sourceDir);
  const folder = basename(sourceDir);
  run(`tar -czf "${outputZip}" -C "${parent}" "${folder}"`);
}

function collectFiles(dir, extensions) {
  const results = [];

  function walk(current) {
    if (!existsSync(current)) {
      return;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
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

function packageServer(platform, version) {
  console.log("\n=== Building Bun Bridge server package ===");
  run("bun run build");

  const zipName = `qenex-server-${version}-${platform}.zip`;
  const zipPath = join(distArtifactsDir, zipName);
  zipDirectory(join(root, "build"), zipPath);
  console.log(`Server artifact: ${zipName}`);
}

function packageVscode(platform, version) {
  console.log("\n=== VS Code extension (deferred) ===");
  console.log(
    "[m8] Skipping VS Code package in v0.3.0 release (IDE Bun Bridge = 0.3.x; see apps/bridge/M7.md).",
  );
  void platform;
  void version;
}

function packageJetbrains(platform, version) {
  console.log("\n=== JetBrains plugin (deferred) ===");
  console.log(
    "[m8] Skipping JetBrains package in v0.3.0 release (IDE Bun Bridge = 0.3.x; see apps/bridge/M7.md).",
  );
  void platform;
  void version;
}

function packageDesktop(platform, version) {
  console.log("\n=== Building Desktop app ===");
  run("bun run package:desktop");
  copyDesktopBundles(platform, version);
}

function main() {
  const { platform, version } = parseArgs();

  console.log(`CI release build: version=${version}, platform=${platform}`);
  rmSync(distArtifactsDir, { recursive: true, force: true });
  mkdirSync(distArtifactsDir, { recursive: true });

  packageServer(platform, version);
  packageVscode(platform, version);
  packageJetbrains(platform, version);
  packageDesktop(platform, version);

  const artifacts = readdirSync(distArtifactsDir)
    .map((name) => {
      const fullPath = join(distArtifactsDir, name);
      const sizeMb = (statSync(fullPath).size / (1024 * 1024)).toFixed(2);
      return `  - ${name} (${sizeMb} MB)`;
    })
    .join("\n");

  console.log("\nRelease artifacts:");
  console.log(artifacts);
  console.log(`\nDone →${distArtifactsDir}`);
}

main();
