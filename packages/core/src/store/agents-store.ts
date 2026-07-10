import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  cloneAgentPreset,
  cloneAgentsConfig,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENTS_CONFIG,
  validateAgentsConfig,
  type AgentPreset,
  type AgentsConfigDocument,
} from "../config/agents.ts";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";

export const AGENTS_PERSIST_KEY = "agent-center-agents";

function scrubLegacyBunxCommands(config: AgentsConfigDocument): AgentsConfigDocument {
  // Migrate old builtin bunx/npx presets to detect-first empty commands.
  const agents = config.agents.map((agent) => {
    const first = agent.command[0];
    const isLegacyLauncher = first === "bunx" || first === "npx";
    const isAdapterPreset =
      agent.registryId === "claude-acp" ||
      agent.registryId === "codex-acp" ||
      agent.id === "claude" ||
      agent.id === "codex" ||
      agent.id === "claude-acp" ||
      agent.id === "codex-acp";
    if (isLegacyLauncher && isAdapterPreset) {
      return { ...agent, command: [] as string[] };
    }
    return agent;
  });
  return { ...config, agents };
}

export type AgentsState = {
  version: 1;
  defaultAgentId: string;
  agents: AgentPreset[];
};

export const agentsStore = proxy<AgentsState>({
  version: 1,
  defaultAgentId: DEFAULT_AGENTS_CONFIG.defaultAgentId,
  agents: cloneAgentsConfig().agents,
});

function toDocument(state: AgentsState = agentsStore): AgentsConfigDocument {
  return {
    version: 1,
    defaultAgentId: state.defaultAgentId,
    agents: state.agents.map(cloneAgentPreset),
  };
}

function applyConfig(config: AgentsConfigDocument) {
  agentsStore.version = 1;
  agentsStore.defaultAgentId = config.defaultAgentId;
  agentsStore.agents = config.agents.map(cloneAgentPreset);
}

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
  return toDocument();
}

export const agentsActions = {
  getConfig(): AgentsConfigDocument {
    return toDocument();
  },

  setConfig(config: AgentsConfigDocument) {
    const validated = validateAgentsConfig(config);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    applyConfig(validated.config);
  },

  upsertAgent(preset: AgentPreset, options?: { makeDefault?: boolean }) {
    const next = cloneAgentsConfig(toDocument());
    const index = next.agents.findIndex((agent) => agent.id === preset.id);
    const cloned = cloneAgentPreset(preset);
    if (index >= 0) {
      next.agents[index] = cloned;
    } else {
      next.agents.push(cloned);
    }
    if (options?.makeDefault) {
      next.defaultAgentId = cloned.id;
    }
    applyConfig(next);
  },

  /**
   * Install from registry: upsert by registry id, and drop legacy builtin
   * aliases (e.g. `claude` when installing `claude-acp`).
   */
  upsertFromRegistry(preset: AgentPreset, legacyIds: string[] = []) {
    const next = cloneAgentsConfig(toDocument());
    const removeIds = new Set(
      legacyIds.filter((id) => id && id !== preset.id),
    );
    next.agents = next.agents.filter((agent) => !removeIds.has(agent.id));
    const index = next.agents.findIndex((agent) => agent.id === preset.id);
    const cloned = cloneAgentPreset({
      ...preset,
      source: preset.source ?? "registry",
      registryId: preset.registryId ?? preset.id,
    });
    if (index >= 0) {
      next.agents[index] = cloned;
    } else {
      next.agents.push(cloned);
    }
    if (removeIds.has(next.defaultAgentId)) {
      next.defaultAgentId = cloned.id;
    }
    applyConfig(next);
  },

  removeAgent(id: string) {
    const next = cloneAgentsConfig(toDocument());
    if (next.agents.length <= 1) {
      throw new Error("至少需要保留一个 Agent");
    }
    const filtered = next.agents.filter((agent) => agent.id !== id);
    if (filtered.length === next.agents.length) {
      return;
    }
    next.agents = filtered;
    if (next.defaultAgentId === id) {
      next.defaultAgentId = filtered[0]!.id;
    }
    applyConfig(next);
  },

  resetToDefault() {
    applyConfig(cloneAgentsConfig());
  },
};

export function useAgentsStore<T>(selector: (state: AgentsState) => T): T {
  const snap = useSnapshot(agentsStore) as AgentsState;
  return selector(snap);
}

export async function hydrateAgentsStore(): Promise<void> {
  await hydrateValtioStore(AGENTS_PERSIST_KEY, agentsStore, {
    merge: (persisted) => {
      const validated = validateAgentsConfig(persisted);
      if (!validated.ok) {
        console.warn(
          "Invalid persisted agents config, using defaults:",
          validated.error,
        );
        return cloneAgentsConfig();
      }
      return scrubLegacyBunxCommands(validated.config);
    },
  });

  // 确保持久化损坏或空列表时仍有可用预设
  if (agentsStore.agents.length === 0) {
    applyConfig(cloneAgentsConfig());
  } else {
    const validated = validateAgentsConfig(toDocument());
    if (!validated.ok) {
      applyConfig(cloneAgentsConfig());
    } else {
      applyConfig(scrubLegacyBunxCommands(validated.config));
    }
  }
}

let unsubscribeAgentsPersist: (() => void) | null = null;

export function startAgentsPersist(): () => void {
  unsubscribeAgentsPersist?.();
  unsubscribeAgentsPersist = subscribeValtioPersist(
    AGENTS_PERSIST_KEY,
    agentsStore,
    {
      partialize: (state) => toDocument(state),
    },
  );
  return () => {
    unsubscribeAgentsPersist?.();
    unsubscribeAgentsPersist = null;
  };
}
