/**
 * Managed Bun install for Desktop/IDE hosts.
 * Resolve order: QENEX_BUN_BIN → ~/.qenex/runtime/bun → download pin → PATH / ~/.bun
 * Download: https://github.com/oven-sh/bun/releases/download/bun-v{version}/bun-{os}-{arch}.zip
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BUN_PIN_FALLBACK = "1.3.14";

const ASSETS = {
  "darwin-arm64": "bun-darwin-aarch64",
  "darwin-x64": "bun-darwin-x64",
  "linux-arm64": "bun-linux-aarch64",
  "linux-x64": "bun-linux-x64",
  "win32-x64": "bun-windows-x64",
};

export function bunExecutableName(platform = process.platform) {
  return platform === "win32" ? "bun.exe" : "bun";
}

export function managedBunRoot(home = homedir()) {
  return join(home, ".qenex", "runtime", "bun");
}

export function managedBunBin(home = homedir(), platform = process.platform) {
  return join(managedBunRoot(home), "bin", bunExecutableName(platform));
}

export function managedBunVersionPath(home = homedir()) {
  return join(managedBunRoot(home), ".version");
}

export function bunAssetName(
  platform = process.platform,
  arch = process.arch,
) {
  const key = `${platform}-${arch}`;
  const asset = ASSETS[key];
  if (!asset) {
    throw new Error(
      `No official Bun zip for ${platform}/${arch}. Set QENEX_BUN_BIN to a bun executable.`,
    );
  }
  return asset;
}

export function bunDownloadUrl(version, platform = process.platform, arch = process.arch) {
  const asset = bunAssetName(platform, arch);
  return `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${asset}.zip`;
}

export function readPinnedBunVersion(repoRoot) {
  const fromEnv = process.env.QENEX_BUN_VERSION?.trim();
  if (fromEnv) return fromEnv;
  const file = join(repoRoot, "runtime", "bun-version");
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8").trim();
    if (text) return text;
  }
  return BUN_PIN_FALLBACK;
}

function repoRootFromHere() {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function bunMissingError(version, target) {
  return (
    `Bun ${version} is not installed at ${target}. ` +
    `Qenex tried to download the official zip and failed. ` +
    `Install Bun, or set QENEX_BUN_BIN to a bun executable.`
  );
}

function whichInPath(name, pathEnv = process.env.PATH ?? "") {
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    if (!dir.trim()) continue;
    const candidate = join(dir.trim(), name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function fallbackBun(pathEnv) {
  const exe = bunExecutableName();
  const fromPath = whichInPath(exe, pathEnv) ?? whichInPath("bun", pathEnv);
  if (fromPath) return fromPath;
  const homeBun = join(homedir(), ".bun", "bin", exe);
  if (existsSync(homeBun)) return homeBun;
  return null;
}

function unzipTo(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Force -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}'`,
      ],
      { encoding: "utf8" },
    );
    if (ps.status !== 0) {
      throw new Error(ps.stderr || ps.stdout || "Expand-Archive failed");
    }
    return;
  }
  if (process.platform === "darwin") {
    const ditto = spawnSync("ditto", ["-x", "-k", zipPath, destDir], {
      encoding: "utf8",
    });
    if (ditto.status === 0) return;
  }
  const unzip = spawnSync("unzip", ["-o", zipPath, "-d", destDir], {
    encoding: "utf8",
  });
  if (unzip.status !== 0) {
    throw new Error(unzip.stderr || unzip.stdout || "unzip failed");
  }
}

function findExtractedBun(root) {
  const exe = bunExecutableName();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === exe || entry.name === "bun") return full;
    }
  }
  return null;
}

async function downloadZip(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`download ${url} failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

/**
 * @param {{ download?: boolean, pathEnv?: string, onProgress?: (msg: string) => void }} [opts]
 * @returns {Promise<string>} absolute bun executable
 */
export async function ensureManagedBun(opts = {}) {
  const download = opts.download !== false;
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const pin = readPinnedBunVersion(repoRootFromHere());
  const target = managedBunBin();
  const versionFile = managedBunVersionPath();
  const log = opts.onProgress ?? (() => {});

  const override = process.env.QENEX_BUN_BIN?.trim();
  if (override) {
    if (existsSync(override) || whichInPath(override, pathEnv)) return override;
    throw new Error(`QENEX_BUN_BIN not found: ${override}`);
  }

  if (existsSync(target)) {
    const installed = existsSync(versionFile)
      ? readFileSync(versionFile, "utf8").trim()
      : "";
    if (!installed || installed === pin) return target;
  }

  if (download) {
    const url = bunDownloadUrl(pin);
    const staging = mkdtempSync(join(tmpdir(), "qenex-bun-"));
    try {
      log(`Downloading Bun ${pin}…`);
      const zipPath = join(staging, "bun.zip");
      await downloadZip(url, zipPath);
      const extractDir = join(staging, "extract");
      unzipTo(zipPath, extractDir);
      const extracted = findExtractedBun(extractDir);
      if (!extracted) {
        throw new Error(`zip from ${url} did not contain a bun binary`);
      }
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(extracted, target);
      if (process.platform !== "win32") chmodSync(target, 0o755);
      writeFileSync(versionFile, `${pin}\n`);
      log(`Installed Bun ${pin} to ${target}`);
      return target;
    } catch (err) {
      const fallback = fallbackBun(pathEnv);
      if (fallback) {
        log(
          `Managed Bun download failed (${err instanceof Error ? err.message : err}); using ${fallback}`,
        );
        return fallback;
      }
      throw new Error(
        `${bunMissingError(pin, target)} (${err instanceof Error ? err.message : err})`,
      );
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  const fallback = fallbackBun(pathEnv);
  if (fallback) return fallback;
  throw new Error(bunMissingError(pin, target));
}

if (import.meta.main) {
  const bun = await ensureManagedBun({
    onProgress: (msg) => console.error(`[qenex] ${msg}`),
  });
  console.log(bun);
}
