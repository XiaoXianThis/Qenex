/**
 * Stage apps/bridge into destDir with a real local node_modules.
 * Installs in os.tmpdir() first so monorepo workspaces do not hoist deps away.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const bridgeDir = join(root, "apps", "bridge");

export function listBridgeFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "." || name === ".qenex-bridge-files") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listBridgeFiles(full, base));
    } else {
      out.push(relative(base, full).split("\\").join("/"));
    }
  }
  return out;
}

/**
 * @param {string} destDir
 * @param {{ includeNodeModules?: boolean, log?: (...args: unknown[]) => void }} [opts]
 */
export function stageBunBridge(destDir, opts = {}) {
  const includeNodeModules = opts.includeNodeModules !== false;
  const log = opts.log ?? console.log.bind(console);
  const tmp = mkdtempSync(join(tmpdir(), "qenex-bridge-stage-"));
  try {
    mkdirSync(join(tmp, "src"), { recursive: true });
    cpSync(join(bridgeDir, "src"), join(tmp, "src"), { recursive: true });
    cpSync(join(bridgeDir, "package.json"), join(tmp, "package.json"));

    log("[m9] bun install --production (isolated tmp, not monorepo hoist)…");
    execSync("bun install --production", { cwd: tmp, stdio: "inherit" });

    const aiPkg = join(tmp, "node_modules", "ai", "package.json");
    if (!existsSync(aiPkg)) {
      throw new Error(
        `staged bridge missing ${aiPkg} — bun install did not create local deps`,
      );
    }

    if (!includeNodeModules) {
      // JetBrains: keep plugin resources lean; runtime bun install on first use.
      rmSync(join(tmp, "node_modules"), { recursive: true, force: true });
      for (const lock of ["bun.lock", "bun.lockb", "package-lock.json"]) {
        rmSync(join(tmp, lock), { force: true });
      }
    }

    rmSync(destDir, { recursive: true, force: true });
    mkdirSync(dirname(destDir), { recursive: true });
    cpSync(tmp, destDir, { recursive: true });

    const files = listBridgeFiles(destDir);
    writeFileSync(
      join(destDir, ".qenex-bridge-files"),
      `${files.join("\n")}\n`,
      "utf8",
    );
    log(`[m9] staged ${files.length} bridge files → ${destDir}`);
    return { files, destDir, hasNodeModules: includeNodeModules };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
