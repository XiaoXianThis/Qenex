export type AgentPresetSource = "builtin" | "registry" | "custom";

export type AgentPreset = {
  id: string;
  name: string;
  command: string[];
  /** Optional provenance; omitted in older persisted configs. */
  source?: AgentPresetSource;
  /** Official ACP registry id when installed from registry. */
  registryId?: string;
};

export type AgentsConfigDocument = {
  version: 1;
  defaultAgentId: string;
  agents: AgentPreset[];
};

export const DEFAULT_AGENT_PRESETS: AgentPreset[] = [
  {
    id: "opencode",
    name: "OpenCode",
    command: ["opencode", "acp"],
    source: "builtin",
  },
  {
    id: "kiro",
    name: "Kiro",
    command: ["kiro-cli", "acp"],
    source: "builtin",
  },
  {
    id: "claude",
    name: "Claude",
    // Empty = resolve at runtime via registryId (detect / ~/.qenex / install).
    command: [],
    source: "builtin",
    registryId: "claude-acp",
  },
  {
    id: "codex",
    name: "Codex",
    command: [],
    source: "builtin",
    registryId: "codex-acp",
  },
];

/** Map legacy / builtin ids onto official registry ids when installing. */
export const BUILTIN_TO_REGISTRY_ID: Record<string, string> = {
  claude: "claude-acp",
  codex: "codex-acp",
  opencode: "opencode",
  kiro: "kiro",
};

/** Resolve id used by Bridge detect/spawn (registry id preferred). */
export function resolveAgentBridgeId(agent: {
  id: string;
  registryId?: string;
}): string {
  if (agent.registryId?.trim()) {
    return agent.registryId.trim();
  }
  return BUILTIN_TO_REGISTRY_ID[agent.id] ?? agent.id;
}

/** Non-empty command means user/advanced override; empty lets Bridge detect. */
export function agentCommandOverride(command: string[] | undefined): string[] | undefined {
  if (!command || command.length === 0) {
    return undefined;
  }
  return command;
}

export const DEFAULT_AGENT_ID = "opencode";

export const DEFAULT_AGENTS_CONFIG: AgentsConfigDocument = {
  version: 1,
  defaultAgentId: DEFAULT_AGENT_ID,
  agents: DEFAULT_AGENT_PRESETS.map((agent) => ({
    ...agent,
    command: [...agent.command],
  })),
};

/** @deprecated 使用 agentsStore / listAgentPresets；保留兼容旧导入 */
export const AGENT_PRESETS = DEFAULT_AGENT_PRESETS;

export type AgentsConfigValidation =
  | { ok: true; config: AgentsConfigDocument }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseAgentPreset(value: unknown, index: number): AgentPreset | string {
  if (!value || typeof value !== "object") {
    return `agents[${index}] 必须是对象`;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.id)) {
    return `agents[${index}].id 必须是非空字符串`;
  }
  if (!isNonEmptyString(record.name)) {
    return `agents[${index}].name 必须是非空字符串`;
  }
  if (!Array.isArray(record.command)) {
    return `agents[${index}].command 必须是字符串数组（可为空，表示由 Bridge 按 registryId 解析）`;
  }
  if (!record.command.every((part) => isNonEmptyString(part))) {
    return `agents[${index}].command 各项必须是非空字符串`;
  }
  const registryIdHint =
    record.registryId !== undefined && record.registryId !== null
      ? String(record.registryId)
      : undefined;
  if (
    record.command.length === 0 &&
    !registryIdHint &&
    record.id !== "claude" &&
    record.id !== "codex"
  ) {
    // Allow empty command only when Bridge can resolve via registryId / known id.
    const knownResolvable =
      typeof record.id === "string" &&
      ["opencode", "kiro", "claude-acp", "codex-acp"].includes(
        String(record.id).trim(),
      );
    if (!knownResolvable) {
      return `agents[${index}].command 为空时需要提供 registryId，或使用已知 Agent id`;
    }
  }

  let source: AgentPresetSource | undefined;
  if (record.source !== undefined && record.source !== null) {
    if (
      record.source !== "builtin" &&
      record.source !== "registry" &&
      record.source !== "custom"
    ) {
      return `agents[${index}].source 必须是 builtin | registry | custom`;
    }
    source = record.source;
  }

  let registryId: string | undefined;
  if (record.registryId !== undefined && record.registryId !== null) {
    if (!isNonEmptyString(record.registryId)) {
      return `agents[${index}].registryId 必须是非空字符串`;
    }
    registryId = record.registryId.trim();
  }

  return {
    id: record.id.trim(),
    name: record.name.trim(),
    command: record.command.map((part) => String(part).trim()),
    ...(source ? { source } : {}),
    ...(registryId ? { registryId } : {}),
  };
}

export function validateAgentsConfig(value: unknown): AgentsConfigValidation {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "配置根节点必须是对象" };
  }
  const record = value as Record<string, unknown>;

  if (record.version !== 1 && record.version !== undefined) {
    return { ok: false, error: "version 必须为 1" };
  }

  if (!Array.isArray(record.agents)) {
    return { ok: false, error: "agents 必须是数组" };
  }
  if (record.agents.length === 0) {
    return { ok: false, error: "至少需要配置一个 Agent" };
  }

  const agents: AgentPreset[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < record.agents.length; i++) {
    const parsed = parseAgentPreset(record.agents[i], i);
    if (typeof parsed === "string") {
      return { ok: false, error: parsed };
    }
    if (seenIds.has(parsed.id)) {
      return { ok: false, error: `重复的 Agent id: ${parsed.id}` };
    }
    seenIds.add(parsed.id);
    agents.push(parsed);
  }

  let defaultAgentId: string;
  if (record.defaultAgentId === undefined || record.defaultAgentId === null) {
    defaultAgentId = agents[0]!.id;
  } else if (!isNonEmptyString(record.defaultAgentId)) {
    return { ok: false, error: "defaultAgentId 必须是非空字符串" };
  } else {
    defaultAgentId = record.defaultAgentId.trim();
    if (!seenIds.has(defaultAgentId)) {
      return {
        ok: false,
        error: `defaultAgentId "${defaultAgentId}" 不在 agents 列表中`,
      };
    }
  }

  return {
    ok: true,
    config: {
      version: 1,
      defaultAgentId,
      agents,
    },
  };
}

export function parseAgentsConfigJson(text: string): AgentsConfigValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `JSON 语法错误: ${message}` };
  }
  return validateAgentsConfig(parsed);
}

export function formatAgentsConfig(config: AgentsConfigDocument): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function cloneAgentPreset(agent: AgentPreset): AgentPreset {
  return {
    id: agent.id,
    name: agent.name,
    command: [...agent.command],
    ...(agent.source ? { source: agent.source } : {}),
    ...(agent.registryId ? { registryId: agent.registryId } : {}),
  };
}

export function cloneAgentsConfig(
  config: AgentsConfigDocument = DEFAULT_AGENTS_CONFIG,
): AgentsConfigDocument {
  return {
    version: 1,
    defaultAgentId: config.defaultAgentId,
    agents: config.agents.map(cloneAgentPreset),
  };
}
