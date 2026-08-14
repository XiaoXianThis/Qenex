/**
 * Stage apps/bridge as a self-contained Bun bundle.
 *
 * Dependencies are resolved from the repository's locked install at build time,
 * so packaged hosts never write into their install directory or access a package
 * registry on first launch.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
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
 * @param {{ log?: (...args: unknown[]) => void }} [opts]
 */
export function stageBunBridge(destDir, opts = {}) {
  const log = opts.log ?? console.log.bind(console);
  const tmp = mkdtempSync(join(tmpdir(), "qenex-bridge-stage-"));
  try {
    cpSync(join(bridgeDir, "package.json"), join(tmp, "package.json"));

    log("[bridge] bundling production runtime from repository lock…");
    execFileSync(
      "bun",
      [
        "build",
        join(bridgeDir, "src", "index.ts"),
        "--target",
        "bun",
        "--outfile",
        join(tmp, "index.js"),
      ],
      { cwd: root, stdio: "inherit" },
    );

    rmSync(destDir, { recursive: true, force: true });
    mkdirSync(dirname(destDir), { recursive: true });
    cpSync(tmp, destDir, { recursive: true });

    const files = listBridgeFiles(destDir);
    writeFileSync(
      join(destDir, ".qenex-bridge-files"),
      `${files.join("\n")}\n`,
      "utf8",
    );
    log(`[bridge] staged ${files.length} files → ${destDir}`);
    return { files, destDir, bundledEntry: join(destDir, "index.js") };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
