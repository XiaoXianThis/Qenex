import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  cloneAgentPreset,
  cloneOverlayEntry,
  clonePersistedDocument,
  defaultPersistedDocument,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENTS_CONFIG,
  effectiveToReplaceOverlay,
  emptyExtendOverlayDraft,
  formatOverlayDocument,
  legacyIdsForRegistry,
  mergeAgentsConfig,
  migrateToPersistedDocument,
  scrubLegacyBunxCommands,
  type AgentOverlayEntry,
  type AgentPreset,
  type AgentsConfigDocument,
  type AgentsJsonMode,
  type AgentsOverlayDocument,
  type AgentsPersistedDocument,
} from "../config/agents.ts";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";

export const AGENTS_PERSIST_KEY = "agent-center-agents";

export type AgentsState = {
  version: 2;
  mode: AgentsJsonMode;
  defaultAgentId: string;
  systemAgents: AgentPreset[];
  overlay: AgentOverlayEntry[];
  /** Derived effective list for UI / spawn. */
  agents: AgentPreset[];
};

function recomputeEffective(state: AgentsState = agentsStore): void {
  const effective = mergeAgentsConfig(
    state.systemAgents,
    state.mode,
    state.overlay,
    state.defaultAgentId,
  );
  state.agents = effective.agents.map(cloneAgentPreset);
  // Keep preferred default if still present after merge.
  if (effective.agents.some((a) => a.id === state.defaultAgentId)) {
    // ok
  } else {
    state.defaultAgentId = effective.defaultAgentId;
  }
}

function applyPersisted(doc: AgentsPersistedDocument) {
  agentsStore.version = 2;
  agentsStore.mode = doc.mode;
  agentsStore.defaultAgentId = doc.defaultAgentId;
  agentsStore.systemAgents = doc.systemAgents.map(cloneAgentPreset);
  agentsStore.overlay = doc.overlay.map(cloneOverlayEntry);
  recomputeEffective();
}

function toPersisted(state: AgentsState = agentsStore): AgentsPersistedDocument {
  return {
    version: 2,
    mode: state.mode,
    defaultAgentId: state.defaultAgentId,
    systemAgents: state.systemAgents.map(cloneAgentPreset),
    overlay: state.overlay.map(cloneOverlayEntry),
  };
}

function toEffectiveDocument(state: AgentsState = agentsStore): AgentsConfigDocument {
  return mergeAgentsConfig(
    state.systemAgents,
    state.mode,
    state.overlay,
    state.defaultAgentId,
  );
}

const initial = defaultPersistedDocument();

export const agentsStore = proxy<AgentsState>({
  version: 2,
  mode: initial.mode,
  defaultAgentId: initial.defaultAgentId,
  systemAgents: initial.systemAgents.map(cloneAgentPreset),
  overlay: [],
  agents: mergeAgentsConfig(
    initial.systemAgents,
    initial.mode,
    [],
    initial.defaultAgentId,
  ).agents.map(cloneAgentPreset),
});

export function listAgentPresets(): AgentPreset[] {
  return agentsStore.agents.map(cloneAgentPreset);
}

export function getAgentPreset(id: string): AgentPreset {
  const found =
    agentsStore.agents.find((agent) => agent.id === id) ??
    agentsStore.agents.find(
      (agent) => agent.id === agentsStore.defaultAgentId,
    ) ??
    agentsStore.agents[0] ??
    DEFAULT_AGENTS_CONFIG.agents.find((agent) => agent.id === DEFAULT_AGENT_ID)!;

  return cloneAgentPreset(found);
}

export function getAgentsConfigDocument(): AgentsConfigDocument {
  return toEffectiveDocument();
}

export const agentsActions = {
  getConfig(): AgentsConfigDocument {
    return toEffectiveDocument();
  },

  getPersisted(): AgentsPersistedDocument {
    return toPersisted();
  },

  getMode(): AgentsJsonMode {
    return agentsStore.mode;
  },

  getOverlayDraft(): AgentsOverlayDocument {
    if (agentsStore.mode === "replace") {
      return {
        version: 2,
        mode: "replace",
        defaultAgentId: agentsStore.defaultAgentId,
        agents: agentsStore.overlay.map(cloneOverlayEntry),
      };
    }
    if (agentsStore.mode === "extend") {
      return {
        version: 2,
        mode: "extend",
        defaultAgentId: agentsStore.defaultAgentId,
        agents: agentsStore.overlay.map(cloneOverlayEntry),
      };
    }
    return emptyExtendOverlayDraft(agentsStore.defaultAgentId);
  },

  formatOverlayDraft(): string {
    return formatOverlayDocument(this.getOverlayDraft());
  },

  /**
   * Enable JSON overlay. Default mode is extend.
   * When switching to replace, seed overlay from current effective list.
   */
  setMode(mode: AgentsJsonMode) {
    if (mode === agentsStore.mode) return;
    if (mode === "off") {
      agentsStore.mode = "off";
      // Keep overlay for when user re-enables.
      recomputeEffective();
      return;
    }
    if (mode === "extend") {
      if (agentsStore.mode === "replace") {
        // Coming from replace: keep overlay entries as extend patches.
        agentsStore.mode = "extend";
      } else {
        agentsStore.mode = "extend";
        if (agentsStore.overlay.length === 0) {
          // start with empty extend patches
        }
      }
      recomputeEffective();
      return;
    }
    // replace
    if (agentsStore.mode !== "replace" || agentsStore.overlay.length === 0) {
      const seed = effectiveToReplaceOverlay(toEffectiveDocument());
      agentsStore.overlay = seed.agents.map(cloneOverlayEntry);
      agentsStore.defaultAgentId = seed.defaultAgentId ?? agentsStore.defaultAgentId;
    }
    agentsStore.mode = "replace";
    recomputeEffective();
  },

  /** Apply user overlay JSON (extend or replace content). */
  setOverlay(doc: AgentsOverlayDocument) {
    const mode = doc.mode ?? (agentsStore.mode === "off" ? "extend" : agentsStore.mode);
    if (mode === "off") {
      agentsStore.mode = "off";
      recomputeEffective();
      return;
    }
    agentsStore.mode = mode === "replace" ? "replace" : "extend";
    agentsStore.overlay = doc.agents.map(cloneOverlayEntry);
    if (doc.defaultAgentId) {
      agentsStore.defaultAgentId = doc.defaultAgentId;
    }
    recomputeEffective();
  },

  /**
   * @deprecated Prefer setOverlay / setMode. Kept for callers that still pass a
   * flat v1 document — applied as replace overlay.
   */
  setConfig(config: AgentsConfigDocument) {
    agentsStore.mode = "replace";
    agentsStore.overlay = config.agents.map((a) => ({
      id: a.id,
      name: a.name,
      command: [...a.command],
      ...(a.registryId ? { registryId: a.registryId } : {}),
    }));
    agentsStore.defaultAgentId = config.defaultAgentId;
    recomputeEffective();
  },

  upsertAgent(preset: AgentPreset, options?: { makeDefault?: boolean }) {
    // System-layer upsert (install / detect / UI).
    const index = agentsStore.systemAgents.findIndex((a) => a.id === preset.id);
    const cloned = cloneAgentPreset(preset);
    if (index >= 0) {
      agentsStore.systemAgents[index] = cloned;
    } else {
      agentsStore.systemAgents.push(cloned);
    }
    if (options?.makeDefault) {
      agentsStore.defaultAgentId = cloned.id;
    }
    recomputeEffective();
  },

  /**
   * Install from registry: upsert by registry id, and drop legacy builtin
   * aliases (e.g. `claude` when installing `claude-acp`).
   */
  upsertFromRegistry(preset: AgentPreset, legacyIds: string[] = []) {
    const removeIds = new Set(
      legacyIds.filter((id) => id && id !== preset.id),
    );
    agentsStore.systemAgents = agentsStore.systemAgents.filter(
      (agent) => !removeIds.has(agent.id),
    );
    const cloned = cloneAgentPreset({
      ...preset,
      source: preset.source ?? "registry",
      registryId: preset.registryId ?? preset.id,
    });
    const index = agentsStore.systemAgents.findIndex(
      (agent) => agent.id === preset.id,
    );
    if (index >= 0) {
      agentsStore.systemAgents[index] = cloned;
    } else {
      agentsStore.systemAgents.push(cloned);
    }
    if (removeIds.has(agentsStore.defaultAgentId)) {
      agentsStore.defaultAgentId = cloned.id;
    }
    recomputeEffective();
  },

  /**
   * Merge PATH/vendor-discovered agents into system layer without overwriting
   * user custom commands on existing entries.
   */
  mergeDetectedAgents(
    entries: Array<{
      id: string;
      name: string;
      readiness: string;
    }>,
  ) {
    for (const entry of entries) {
      if (entry.readiness !== "ready" && entry.readiness !== "needAuth") {
        continue;
      }
      const existing = agentsStore.systemAgents.find(
        (agent) => agent.id === entry.id || agent.registryId === entry.id,
      );
      if (existing) {
        if (!existing.registryId) {
          const index = agentsStore.systemAgents.findIndex(
            (a) => a.id === existing.id,
          );
          if (index >= 0) {
            agentsStore.systemAgents[index] = cloneAgentPreset({
              ...existing,
              registryId: entry.id,
            });
          }
        }
        continue;
      }
      this.upsertFromRegistry(
        {
          id: entry.id,
          name: entry.name,
          command: [],
          source: "detected",
          registryId: entry.id,
        },
        legacyIdsForRegistry(entry.id),
      );
    }
    recomputeEffective();
  },

  removeAgent(id: string) {
    // Prefer hiding via overlay when JSON extend is on; otherwise remove from system.
    if (agentsStore.mode === "extend") {
      const existing = agentsStore.overlay.find((e) => e.id === id);
      if (existing) {
        existing.hidden = true;
      } else {
        agentsStore.overlay.push({ id, hidden: true });
      }
      recomputeEffective();
      return;
    }
    if (agentsStore.mode === "replace") {
      agentsStore.overlay = agentsStore.overlay.filter((e) => e.id !== id);
      if (agentsStore.overlay.length === 0) {
        throw new Error("至少需要保留一个 Agent");
      }
      if (agentsStore.defaultAgentId === id) {
        agentsStore.defaultAgentId = agentsStore.overlay[0]!.id;
      }
      recomputeEffective();
      return;
    }
    // mode off: remove from system (except last / OpenCode)
    if (agentsStore.systemAgents.length <= 1) {
      throw new Error("至少需要保留一个 Agent");
    }
    if (id === DEFAULT_AGENT_ID && agentsStore.systemAgents.length === 1) {
      throw new Error("不能移除默认的 OpenCode");
    }
    const filtered = agentsStore.systemAgents.filter((agent) => agent.id !== id);
    if (filtered.length === agentsStore.systemAgents.length) {
      return;
    }
    agentsStore.systemAgents = filtered;
    if (agentsStore.defaultAgentId === id) {
      agentsStore.defaultAgentId = filtered.some((a) => a.id === DEFAULT_AGENT_ID)
        ? DEFAULT_AGENT_ID
        : filtered[0]!.id;
    }
    recomputeEffective();
  },

  setDefaultAgentId(id: string) {
    if (!agentsStore.agents.some((a) => a.id === id)) {
      throw new Error(`Agent "${id}" 不在有效列表中`);
    }
    agentsStore.defaultAgentId = id;
    recomputeEffective();
  },

  resetToDefault() {
    applyPersisted(defaultPersistedDocument());
  },
};

export function useAgentsStore<T>(selector: (state: AgentsState) => T): T {
  const snap = useSnapshot(agentsStore) as AgentsState;
  return selector(snap);
}

export async function hydrateAgentsStore(): Promise<void> {
  await hydrateValtioStore(AGENTS_PERSIST_KEY, agentsStore, {
    merge: (persisted) => {
      const migrated = migrateToPersistedDocument(persisted);
      if (!migrated.ok) {
        console.warn(
          "Invalid persisted agents config, using defaults:",
          migrated.error,
        );
        return clonePersistedDocument();
      }
      const scrubbedSystem = scrubLegacyBunxCommands({
        version: 1,
        defaultAgentId: migrated.document.defaultAgentId,
        agents: migrated.document.systemAgents,
      }).agents;
      return {
        ...migrated.document,
        systemAgents: scrubbedSystem,
      };
    },
  });

  // hydrateValtioStore writes fields onto the proxy; normalize shape.
  const migrated = migrateToPersistedDocument({
    version: agentsStore.version,
    mode: agentsStore.mode,
    defaultAgentId: agentsStore.defaultAgentId,
    systemAgents: agentsStore.systemAgents,
    overlay: agentsStore.overlay,
  });
  if (migrated.ok) {
    applyPersisted(migrated.document);
  } else {
    applyPersisted(defaultPersistedDocument());
  }

  if (agentsStore.agents.length === 0) {
    applyPersisted(defaultPersistedDocument());
  }
}

let unsubscribeAgentsPersist: (() => void) | null = null;

export function startAgentsPersist(): () => void {
  unsubscribeAgentsPersist?.();
  unsubscribeAgentsPersist = subscribeValtioPersist(
    AGENTS_PERSIST_KEY,
    agentsStore,
    {
      partialize: (state) => toPersisted(state),
    },
  );
  return () => {
    unsubscribeAgentsPersist?.();
    unsubscribeAgentsPersist = null;
  };
}
