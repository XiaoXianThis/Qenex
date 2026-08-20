/** Managed Qenex home layout under `~/.qenex`. */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function qenexHome(): string {
  return join(homedir(), ".qenex");
}

export function runtimeBunDir(): string {
  return join(qenexHome(), "runtime", "bun");
}

export function runtimeUvDir(): string {
  return join(qenexHome(), "runtime", "uv");
}

export function managedBunBin(): string {
  const exe = process.platform === "win32" ? "bun.exe" : "bun";
  return join(runtimeBunDir(), "bin", exe);
}

/** Prefer the interpreter that spawned this Bridge, then managed runtime, then PATH. */
export function resolveBunExecutable(): string {
  const exec = process.execPath;
  if (typeof exec === "string" && /bun/i.test(exec) && existsSync(exec)) {
    return exec;
  }
  const managed = managedBunBin();
  if (existsSync(managed)) return managed;
  return Bun.which("bun") ?? "bun";
}

export function agentsDir(): string {
  return join(qenexHome(), "agents");
}

export function hostsDir(): string {
  return join(qenexHome(), "hosts");
}

export function agentVersionDir(agentId: string, version: string): string {
  return join(agentsDir(), agentId, version);
}

export function installedDbPath(): string {
  return join(qenexHome(), "installed.json");
}

export function registryCachePath(): string {
  return join(qenexHome(), "registry-cache.json");
}

export function ensureQenexDirs(): void {
  for (const dir of [
    qenexHome(),
    runtimeBunDir(),
    runtimeUvDir(),
    agentsDir(),
    hostsDir(),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}
