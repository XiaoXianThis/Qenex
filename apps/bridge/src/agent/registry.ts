import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureQenexDirs, registryCachePath } from "./paths.ts";
import type {
  InstallPlan,
  RegistryAgentRaw,
  RegistryDocument,
} from "./types.ts";

export const REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

export const CACHE_TTL_SECS = 3600;

type CacheFile = {
  fetched_at: number;
  document: RegistryDocument;
};

export function currentPlatformKey(): string {
  const os =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "windows"
        : "linux";
  const arch =
    process.arch === "arm64"
      ? "aarch64"
      : process.arch === "x64"
        ? "x86_64"
        : process.arch;
  return `${os}-${arch}`;
}

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function readCache(cachePath = registryCachePath()): CacheFile | null {
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
  } catch {
    return null;
  }
}

function writeCache(document: RegistryDocument, cachePath = registryCachePath()): void {
  if (cachePath === registryCachePath()) ensureQenexDirs();
  const file: CacheFile = { fetched_at: nowSecs(), document };
  writeFileSync(cachePath, `${JSON.stringify(file)}\n`, "utf8");
}

async function fetchRegistryDocument(): Promise<RegistryDocument> {
  const res = await fetch(REGISTRY_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`registry HTTP ${res.status}`);
  }
  const document = (await res.json()) as RegistryDocument;
  if (!document?.agents || !Array.isArray(document.agents)) {
    throw new Error("invalid registry document");
  }
  return document;
}

const backgroundRefresh = new Map<string, Promise<void>>();

function scheduleBackgroundRefresh(cachePath: string): void {
  if (backgroundRefresh.has(cachePath)) return;
  const promise = fetchRegistryDocument()
    .then((document) => {
      writeCache(document, cachePath);
    })
    .catch(() => {
      /* stale cache remains usable */
    })
    .finally(() => {
      backgroundRefresh.delete(cachePath);
    });
  backgroundRefresh.set(cachePath, promise);
}

/** Test helper: wait for any in-flight stale-while-revalidate fetch. */
export async function waitForRegistryRefresh(
  cachePath = registryCachePath(),
): Promise<void> {
  const pending = backgroundRefresh.get(cachePath);
  if (pending) await pending;
}

export async function loadRegistryDocument(
  refresh = false,
  cachePath = registryCachePath(),
): Promise<RegistryDocument> {
  const cached = readCache(cachePath);
  if (!refresh && cached?.document) {
    if (nowSecs() - cached.fetched_at >= CACHE_TTL_SECS) {
      scheduleBackgroundRefresh(cachePath);
    }
    return cached.document;
  }

  try {
    const document = await fetchRegistryDocument();
    writeCache(document, cachePath);
    return document;
  } catch (err) {
    if (cached?.document) return cached.document;
    throw new Error(
      err instanceof Error ? err.message : "failed to load ACP registry",
    );
  }
}

export async function findRegistryAgent(
  agentId: string,
  refresh = false,
): Promise<RegistryAgentRaw | null> {
  const doc = await loadRegistryDocument(refresh);
  return doc.agents.find((a) => a.id === agentId) ?? null;
}

export function resolveInstallPlan(agent: RegistryAgentRaw): InstallPlan {
  const platform = currentPlatformKey();
  const binary = agent.distribution?.binary?.[platform];
  if (binary?.archive && binary.cmd) {
    return { kind: "binary", binary };
  }
  if (agent.distribution?.npx?.package) {
    return { kind: "npx", package: agent.distribution.npx };
  }
  if (agent.distribution?.uvx?.package) {
    return { kind: "uvx", package: agent.distribution.uvx };
  }
  throw new Error(
    `No install plan for '${agent.id}' on platform ${platform}`,
  );
}

export function preferredKindFor(
  agent: RegistryAgentRaw,
): InstallPlan["kind"] | null {
  try {
    return resolveInstallPlan(agent).kind;
  } catch {
    return null;
  }
}
