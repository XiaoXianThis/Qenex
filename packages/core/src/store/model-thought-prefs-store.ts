import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";

export const MODEL_THOUGHT_PREFS_KEY = "agent-center-model-thought-prefs";

export type ModelThoughtPrefsState = {
  /** agentId → modelId → thoughtLevelId */
  byAgent: Record<string, Record<string, string>>;
  /** agentId → modelId → fast option id */
  fastByAgent: Record<string, Record<string, string>>;
  /** agentId → last selected modelId */
  preferredModelByAgent: Record<string, string>;
  /** agentId → last selected modeId */
  preferredModeByAgent: Record<string, string>;
};

export const modelThoughtPrefsStore = proxy<ModelThoughtPrefsState>({
  byAgent: {},
  fastByAgent: {},
  preferredModelByAgent: {},
  preferredModeByAgent: {},
});

export const modelThoughtPrefsActions = {
  get(agentId: string, modelId: string): string | null {
    return modelThoughtPrefsStore.byAgent[agentId]?.[modelId] ?? null;
  },

  set(agentId: string, modelId: string, thoughtLevelId: string) {
    const current = modelThoughtPrefsStore.byAgent[agentId] ?? {};
    modelThoughtPrefsStore.byAgent = {
      ...modelThoughtPrefsStore.byAgent,
      [agentId]: {
        ...current,
        [modelId]: thoughtLevelId,
      },
    };
  },

  getFast(agentId: string, modelId: string): string | null {
    return modelThoughtPrefsStore.fastByAgent[agentId]?.[modelId] ?? null;
  },

  setFast(agentId: string, modelId: string, fastId: string) {
    const current = modelThoughtPrefsStore.fastByAgent[agentId] ?? {};
    modelThoughtPrefsStore.fastByAgent = {
      ...modelThoughtPrefsStore.fastByAgent,
      [agentId]: {
        ...current,
        [modelId]: fastId,
      },
    };
  },

  getPreferredModel(agentId: string): string | null {
    return modelThoughtPrefsStore.preferredModelByAgent[agentId] ?? null;
  },

  setPreferredModel(agentId: string, modelId: string) {
    modelThoughtPrefsStore.preferredModelByAgent = {
      ...modelThoughtPrefsStore.preferredModelByAgent,
      [agentId]: modelId,
    };
  },

  getPreferredMode(agentId: string): string | null {
    return modelThoughtPrefsStore.preferredModeByAgent[agentId] ?? null;
  },

  setPreferredMode(agentId: string, modeId: string) {
    modelThoughtPrefsStore.preferredModeByAgent = {
      ...modelThoughtPrefsStore.preferredModeByAgent,
      [agentId]: modeId,
    };
  },
};

export function useModelThoughtPrefsStore<T>(
  selector: (state: ModelThoughtPrefsState) => T,
): T {
  const snap = useSnapshot(modelThoughtPrefsStore) as ModelThoughtPrefsState;
  return selector(snap);
}

export async function hydrateModelThoughtPrefsStore(): Promise<void> {
  await hydrateValtioStore(MODEL_THOUGHT_PREFS_KEY, modelThoughtPrefsStore, {
    merge: (persisted) => {
      if (!persisted || typeof persisted !== "object") {
        return {};
      }
      const record = persisted as Partial<ModelThoughtPrefsState>;
      const patch: Partial<ModelThoughtPrefsState> = {};
      if (record.byAgent && typeof record.byAgent === "object") {
        patch.byAgent = record.byAgent;
      }
      if (record.fastByAgent && typeof record.fastByAgent === "object") {
        patch.fastByAgent = record.fastByAgent;
      }
      if (
        record.preferredModelByAgent &&
        typeof record.preferredModelByAgent === "object"
      ) {
        patch.preferredModelByAgent = record.preferredModelByAgent;
      }
      if (
        record.preferredModeByAgent &&
        typeof record.preferredModeByAgent === "object"
      ) {
        patch.preferredModeByAgent = record.preferredModeByAgent;
      }
      return patch;
    },
  });
}

let unsubscribeModelThoughtPrefsPersist: (() => void) | null = null;

export function startModelThoughtPrefsPersist(): () => void {
  unsubscribeModelThoughtPrefsPersist?.();
  unsubscribeModelThoughtPrefsPersist = subscribeValtioPersist(
    MODEL_THOUGHT_PREFS_KEY,
    modelThoughtPrefsStore,
    {
      partialize: (state) => ({
        byAgent: state.byAgent,
        fastByAgent: state.fastByAgent,
        preferredModelByAgent: state.preferredModelByAgent,
        preferredModeByAgent: state.preferredModeByAgent,
      }),
    },
  );
  return () => {
    unsubscribeModelThoughtPrefsPersist?.();
    unsubscribeModelThoughtPrefsPersist = null;
  };
}
