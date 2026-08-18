/**
 * Workspace file listing for Composer `@` mentions (M3).
 * Paths are sandboxed under a realpath-resolved base directory.
 */
import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BridgeError } from "./errors.ts";

export type WorkspaceFileItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
};

export type ListFilesResult = {
  items: WorkspaceFileItem[];
  path: string;
};

const SKIP_ENTRY_NAMES = new Set([
  ".DS_Store",
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
]);

const DIR_LIST_LIMIT = 200;

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveBase(base: string): string {
  const raw = base.trim() || ".";
  const absolute = resolve(raw === "." ? process.cwd() : raw);
  if (!existsSync(absolute)) {
    throw new BridgeError(
      "invalid_cwd",
      `Workspace base does not exist: ${raw}`,
      400,
    );
  }
  try {
    return realpathSync(absolute);
  } catch {
    throw new BridgeError(
      "invalid_cwd",
      `Workspace base is not accessible: ${raw}`,
      400,
    );
  }
}

/** Join base + relative path and refuse escape outside realpath(base). */
export function resolveSafePath(base: string, path: string): string {
  const root = resolveBase(base);
  const candidate = resolve(root, path.trim() || ".");
  let real: string;
  try {
    real = existsSync(candidate) ? realpathSync(candidate) : candidate;
  } catch {
    throw new BridgeError(
      "path_forbidden",
      `Path is not accessible: ${path}`,
      403,
    );
  }
  // When target does not exist yet, still ensure parent/candidate stays in root.
  if (!isWithin(root, real) && !isWithin(root, candidate)) {
    throw new BridgeError(
      "path_forbidden",
      "Path escapes the workspace base directory",
      403,
    );
  }
  return existsSync(candidate) ? real : candidate;
}

export function listWorkspaceFiles(opts: {
  base: string;
  path?: string;
}): ListFilesResult {
  const relPath = (opts.path ?? ".").trim() || ".";
  const full = resolveSafePath(opts.base, relPath);
  const root = resolveBase(opts.base);

  if (!existsSync(full) || !statSync(full).isDirectory()) {
    throw new BridgeError(
      "not_a_directory",
      `Not a directory: ${relPath}`,
      400,
    );
  }

  const entries = readdirSync(full, { withFileTypes: true });
  const items: WorkspaceFileItem[] = [];

  for (const entry of entries) {
    if (SKIP_ENTRY_NAMES.has(entry.name)) continue;
    const absolute = join(full, entry.name);
    let isDirectory = entry.isDirectory();
    let size: number | undefined;
    try {
      const st = statSync(absolute);
      isDirectory = st.isDirectory();
      if (st.isFile()) size = st.size;
    } catch {
      continue;
    }
    const rel = relative(root, absolute).split(sep).join("/");
    items.push({
      name: entry.name,
      path: rel || basename(absolute),
      isDirectory,
      ...(size !== undefined ? { size } : {}),
    });
  }

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  if (items.length > DIR_LIST_LIMIT) items.length = DIR_LIST_LIMIT;

  return { items, path: relPath };
}
