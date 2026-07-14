import { proxy } from "valtio";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";
import type { SessionOption } from "../lib/session-config.ts";

export const MODEL_CONFIG_CACHE_KEY = "agent-center-model-config-cache";

/** Refresh persisted entries older than this in the background. */
export const MODEL_CONFIG_STALE_MS = 12 * 60 * 60 * 1000;

export type ModelConfigCacheEntry = {
  thoughtLevels: SessionOption[];
  fastOptions: SessionOption[];
  updatedAt: number;
};

export type ModelConfigCacheState = {
  /** agentId → modelId → options */
  byAgent: Record<string, Record<string, ModelConfigCacheEntry>>;
};

export const modelConfigCacheStore = proxy<ModelConfigCacheState>({
  byAgent: {},
});

function parseOptions(value: unknown): SessionOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): SessionOption | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = String(record.id ?? "");
      if (!id) return null;
      const name = String(record.name ?? id);
      return { id, name };
    })
    .filter((item): item is SessionOption => item !== null);
}

export const modelConfigCacheActions = {
  get(
    agentId: string,
    modelId: string,
  ): ModelConfigCacheEntry | null {
    return modelConfigCacheStore.byAgent[agentId]?.[modelId] ?? null;
  },

  getAgent(agentId: string): Record<string, ModelConfigCacheEntry> {
    return modelConfigCacheStore.byAgent[agentId] ?? {};
  },

  set(
    agentId: string,
    modelId: string,
    thoughtLevels: SessionOption[],
    fastOptions: SessionOption[],
  ) {
    const current = modelConfigCacheStore.byAgent[agentId] ?? {};
    modelConfigCacheStore.byAgent = {
      ...modelConfigCacheStore.byAgent,
      [agentId]: {
        ...current,
        [modelId]: {
          thoughtLevels,
          fastOptions,
          updatedAt: Date.now(),
        },
      },
    };
  },

  isStale(entry: ModelConfigCacheEntry | null | undefined): boolean {
    if (!entry) return true;
    return Date.now() - entry.updatedAt > MODEL_CONFIG_STALE_MS;
  },
};

export async function hydrateModelConfigCacheStore(): Promise<void> {
  await hydrateValtioStore(MODEL_CONFIG_CACHE_KEY, modelConfigCacheStore, {
    merge: (persisted) => {
      if (!persisted || typeof persisted !== "object") {
        return {};
      }
      const record = persisted as Partial<ModelConfigCacheState>;
      if (!record.byAgent || typeof record.byAgent !== "object") {
        return {};
      }
      const byAgent: Record<string, Record<string, ModelConfigCacheEntry>> = {};
      for (const [agentId, models] of Object.entries(record.byAgent)) {
        if (!models || typeof models !== "object") continue;
        const parsedModels: Record<string, ModelConfigCacheEntry> = {};
        for (const [modelId, entry] of Object.entries(models)) {
          if (!entry || typeof entry !== "object") continue;
          const raw = entry as Record<string, unknown>;
          parsedModels[modelId] = {
            thoughtLevels: parseOptions(raw.thoughtLevels),
            fastOptions: parseOptions(raw.fastOptions),
            updatedAt:
              typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
          };
        }
        byAgent[agentId] = parsedModels;
      }
      return { byAgent };
    },
  });
}

let unsubscribeModelConfigCachePersist: (() => void) | null = null;

export function startModelConfigCachePersist(): () => void {
  unsubscribeModelConfigCachePersist?.();
  unsubscribeModelConfigCachePersist = subscribeValtioPersist(
    MODEL_CONFIG_CACHE_KEY,
    modelConfigCacheStore,
    {
      partialize: (state) => ({ byAgent: state.byAgent }),
      debounceMs: 500,
    },
  );
  return () => {
    unsubscribeModelConfigCachePersist?.();
    unsubscribeModelConfigCachePersist = null;
  };
}
