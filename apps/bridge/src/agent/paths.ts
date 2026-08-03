/** Managed Qenex home layout under `~/.qenex`. */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export function qenexHome(): string {
  return join(homedir(), ".qenex");
}

export function runtimeBunDir(): string {
  return join(qenexHome(), "runtime", "bun");
}

export function runtimeUvDir(): string {
  return join(qenexHome(), "runtime", "uv");
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
