/**
 * Agent presets: system layer (builtin + detected + registry) + optional user JSON overlay.
 *
 * Modes:
 * - off:     system layer only (default)
 * - extend:  merge user overlay onto system (default when JSON enabled)
 * - replace: user JSON is the sole source of truth
 */

export type AgentPresetSource =
  | "builtin"
  | "registry"
  | "custom"
  | "detected";

export type AgentPreset = {
  id: string;
  name: string;
  command: string[];
  /** Optional provenance; omitted in older persisted configs. */
  source?: AgentPresetSource;
  /** Official ACP registry id when installed from registry. */
  registryId?: string;
};

/** How user JSON participates in the effective agent list. */
export type AgentsJsonMode = "off" | "extend" | "replace";

/** Incremental patch applied in `extend` mode (and full list in `replace`). */
export type AgentOverlayEntry = {
  id: string;
  name?: string;
  command?: string[];
  registryId?: string;
  /** Hide a system agent from the effective list without uninstalling. */
  hidden?: boolean;
};

/**
 * Effective agent list consumed by TabBar / spawn (always a flat document).
 * Also the JSON shape used in `replace` mode.
 */
export type AgentsConfigDocument = {
  version: 1;
  defaultAgentId: string;
  agents: AgentPreset[];
};

/**
 * Persisted agents state (v2).
 * System agents are rebuilt from builtin + discover + installs; overlay is user JSON.
 */
export type AgentsPersistedDocument = {
  version: 2;
  mode: AgentsJsonMode;
  defaultAgentId: string;
  /** System layer: builtin + detected + registry installs. */
  systemAgents: AgentPreset[];
  /** User overlay entries (extend) or full custom list seed (replace). */
  overlay: AgentOverlayEntry[];
};

export type AgentsOverlayDocument = {
  version: 2;
  mode?: AgentsJsonMode;
  defaultAgentId?: string;
  agents: AgentOverlayEntry[];
};

export const DEFAULT_AGENT_ID = "opencode";

/** Factory default: only OpenCode. Everything else comes from discover / install. */
export const DEFAULT_AGENT_PRESETS: AgentPreset[] = [
  {
    id: "opencode",
    name: "OpenCode",
    command: ["opencode", "acp"],
    source: "builtin",
  },
];

/** Map legacy / builtin ids onto official registry ids when installing. */
export const BUILTIN_TO_REGISTRY_ID: Record<string, string> = {
  claude: "claude-acp",
  codex: "codex-acp",
  opencode: "opencode",
  kiro: "kiro",
  cursor: "cursor-agent",
};

/** Legacy builtin ids to drop when upserting a registry / detected agent. */
export function legacyIdsForRegistry(registryId: string): string[] {
  const legacy: string[] = [];
  for (const [builtin, mapped] of Object.entries(BUILTIN_TO_REGISTRY_ID)) {
    if (mapped === registryId && builtin !== registryId) {
      legacy.push(builtin);
    }
  }
  return legacy;
}

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

/**
 * Cursor ACP only exposes per-model thought/fast via parameterized picker;
 * other agents already return session-level configOptions over standard ACP.
 */
export function isCursorAgentId(agentId: string | null | undefined): boolean {
  if (!agentId) return false;
  const id = agentId.trim().toLowerCase();
  return (
    id === "cursor" ||
    id === "cursor-agent" ||
    BUILTIN_TO_REGISTRY_ID[id] === "cursor-agent"
  );
}

/** Non-empty command means user/advanced override; empty lets Bridge detect. */
export function agentCommandOverride(
  command: string[] | undefined,
): string[] | undefined {
  if (!command || command.length === 0) {
    return undefined;
  }
  return command;
}

export const DEFAULT_AGENTS_CONFIG: AgentsConfigDocument = {
  version: 1,
  defaultAgentId: DEFAULT_AGENT_ID,
  agents: DEFAULT_AGENT_PRESETS.map((agent) => ({
    ...agent,
    command: [...agent.command],
  })),
};

export function defaultPersistedDocument(): AgentsPersistedDocument {
  return {
    version: 2,
    mode: "off",
    defaultAgentId: DEFAULT_AGENT_ID,
    systemAgents: DEFAULT_AGENT_PRESETS.map(cloneAgentPreset),
    overlay: [],
  };
}

/** @deprecated 使用 agentsStore / listAgentPresets；保留兼容旧导入 */
export const AGENT_PRESETS = DEFAULT_AGENT_PRESETS;

export type AgentsConfigValidation =
  | { ok: true; config: AgentsConfigDocument }
  | { ok: false; error: string };

export type AgentsPersistedValidation =
  | { ok: true; document: AgentsPersistedDocument }
  | { ok: false; error: string };

export type AgentsOverlayValidation =
  | { ok: true; document: AgentsOverlayDocument }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const KNOWN_EMPTY_COMMAND_IDS = new Set([
  "opencode",
  "kiro",
  "claude",
  "codex",
  "claude-acp",
  "codex-acp",
  "cursor",
  "cursor-agent",
  "gemini",
]);

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
  if (record.command.length === 0 && !registryIdHint) {
    const id = String(record.id).trim();
    if (!KNOWN_EMPTY_COMMAND_IDS.has(id)) {
      return `agents[${index}].command 为空时需要提供 registryId，或使用已知 Agent id`;
    }
  }

  let source: AgentPresetSource | undefined;
  if (record.source !== undefined && record.source !== null) {
    if (
      record.source !== "builtin" &&
      record.source !== "registry" &&
      record.source !== "custom" &&
      record.source !== "detected"
    ) {
      return `agents[${index}].source 必须是 builtin | registry | custom | detected`;
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

function parseOverlayEntry(
  value: unknown,
  index: number,
): AgentOverlayEntry | string {
  if (!value || typeof value !== "object") {
    return `agents[${index}] 必须是对象`;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.id)) {
    return `agents[${index}].id 必须是非空字符串`;
  }
  const entry: AgentOverlayEntry = { id: record.id.trim() };

  if (record.name !== undefined && record.name !== null) {
    if (!isNonEmptyString(record.name)) {
      return `agents[${index}].name 必须是非空字符串`;
    }
    entry.name = record.name.trim();
  }
  if (record.command !== undefined && record.command !== null) {
    if (!Array.isArray(record.command)) {
      return `agents[${index}].command 必须是字符串数组`;
    }
    if (!record.command.every((part) => isNonEmptyString(part))) {
      return `agents[${index}].command 各项必须是非空字符串`;
    }
    entry.command = record.command.map((part) => String(part).trim());
  }
  if (record.registryId !== undefined && record.registryId !== null) {
    if (!isNonEmptyString(record.registryId)) {
      return `agents[${index}].registryId 必须是非空字符串`;
    }
    entry.registryId = record.registryId.trim();
  }
  if (record.hidden !== undefined && record.hidden !== null) {
    if (typeof record.hidden !== "boolean") {
      return `agents[${index}].hidden 必须是布尔值`;
    }
    entry.hidden = record.hidden;
  }
  return entry;
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

export function validateOverlayDocument(
  value: unknown,
): AgentsOverlayValidation {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "配置根节点必须是对象" };
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 2 && record.version !== undefined) {
    return { ok: false, error: "overlay version 必须为 2" };
  }
  if (!Array.isArray(record.agents)) {
    return { ok: false, error: "agents 必须是数组" };
  }

  const agents: AgentOverlayEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < record.agents.length; i++) {
    const parsed = parseOverlayEntry(record.agents[i], i);
    if (typeof parsed === "string") {
      return { ok: false, error: parsed };
    }
    if (seen.has(parsed.id)) {
      return { ok: false, error: `重复的 Agent id: ${parsed.id}` };
    }
    seen.add(parsed.id);
    agents.push(parsed);
  }

  let mode: AgentsJsonMode | undefined;
  if (record.mode !== undefined && record.mode !== null) {
    if (record.mode !== "off" && record.mode !== "extend" && record.mode !== "replace") {
      return { ok: false, error: "mode 必须是 off | extend | replace" };
    }
    mode = record.mode;
  }

  let defaultAgentId: string | undefined;
  if (record.defaultAgentId !== undefined && record.defaultAgentId !== null) {
    if (!isNonEmptyString(record.defaultAgentId)) {
      return { ok: false, error: "defaultAgentId 必须是非空字符串" };
    }
    defaultAgentId = record.defaultAgentId.trim();
  }

  return {
    ok: true,
    document: {
      version: 2,
      ...(mode ? { mode } : {}),
      ...(defaultAgentId ? { defaultAgentId } : {}),
      agents,
    },
  };
}

/**
 * Merge system agents with user overlay according to mode.
 */
export function mergeAgentsConfig(
  systemAgents: AgentPreset[],
  mode: AgentsJsonMode,
  overlay: AgentOverlayEntry[],
  preferredDefaultId?: string,
): AgentsConfigDocument {
  const system = systemAgents.map(cloneAgentPreset);
  // Ensure OpenCode builtin always exists in system layer for off/extend.
  if (!system.some((a) => a.id === DEFAULT_AGENT_ID)) {
    system.unshift(cloneAgentPreset(DEFAULT_AGENT_PRESETS[0]!));
  }

  if (mode === "off") {
    const defaultAgentId = pickDefaultId(system, preferredDefaultId);
    return { version: 1, defaultAgentId, agents: system };
  }

  if (mode === "replace") {
    const agents: AgentPreset[] = [];
    for (const entry of overlay) {
      if (entry.hidden) continue;
      const name = entry.name?.trim();
      if (!name) continue;
      agents.push({
        id: entry.id,
        name,
        command: entry.command ? [...entry.command] : [],
        source: "custom",
        ...(entry.registryId ? { registryId: entry.registryId } : {}),
      });
    }
    if (agents.length === 0) {
      // Safety: never leave the app with zero agents.
      return cloneAgentsConfig(DEFAULT_AGENTS_CONFIG);
    }
    const defaultAgentId = pickDefaultId(agents, preferredDefaultId);
    return { version: 1, defaultAgentId, agents };
  }

  // extend
  const hidden = new Set(
    overlay.filter((e) => e.hidden).map((e) => e.id),
  );
  const byId = new Map<string, AgentPreset>();
  for (const agent of system) {
    if (hidden.has(agent.id)) continue;
    byId.set(agent.id, cloneAgentPreset(agent));
  }
  for (const entry of overlay) {
    if (entry.hidden) continue;
    const existing = byId.get(entry.id);
    if (existing) {
      byId.set(entry.id, {
        ...existing,
        ...(entry.name ? { name: entry.name } : {}),
        ...(entry.command ? { command: [...entry.command] } : {}),
        ...(entry.registryId ? { registryId: entry.registryId } : {}),
      });
    } else {
      const name = entry.name?.trim();
      if (!name) continue;
      byId.set(entry.id, {
        id: entry.id,
        name,
        command: entry.command ? [...entry.command] : [],
        source: "custom",
        ...(entry.registryId ? { registryId: entry.registryId } : {}),
      });
    }
  }
  const agents = Array.from(byId.values());
  if (agents.length === 0) {
    return cloneAgentsConfig(DEFAULT_AGENTS_CONFIG);
  }
  const defaultAgentId = pickDefaultId(agents, preferredDefaultId);
  return { version: 1, defaultAgentId, agents };
}

function pickDefaultId(
  agents: AgentPreset[],
  preferred?: string,
): string {
  if (preferred && agents.some((a) => a.id === preferred)) {
    return preferred;
  }
  if (agents.some((a) => a.id === DEFAULT_AGENT_ID)) {
    return DEFAULT_AGENT_ID;
  }
  return agents[0]!.id;
}

/** Migrate v1 flat document or v2 persisted document into v2. */
export function migrateToPersistedDocument(
  value: unknown,
): AgentsPersistedValidation {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "配置根节点必须是对象" };
  }
  const record = value as Record<string, unknown>;

  if (record.version === 2 || record.systemAgents !== undefined) {
    return validatePersistedDocument(value);
  }

  // v1 flat → treat as system agents, mode off (JSON not enabled).
  // Drop legacy builtin shells (claude/codex/kiro) so only OpenCode + real installs remain.
  const v1 = validateAgentsConfig(value);
  if (!v1.ok) {
    return { ok: false, error: v1.error };
  }
  const legacyBuiltinIds = new Set(["claude", "codex", "kiro"]);
  let systemAgents = v1.config.agents
    .filter((a) => {
      if (a.id === DEFAULT_AGENT_ID) return true;
      if (legacyBuiltinIds.has(a.id) && a.source === "builtin") return false;
      // Keep if it looks installed/detected/custom
      return a.source === "registry" || a.source === "detected" || a.source === "custom"
        || (a.command.length > 0 && a.id !== "claude" && a.id !== "codex" && a.id !== "kiro");
    })
    .map(cloneAgentPreset);

  // Always keep OpenCode
  if (!systemAgents.some((a) => a.id === DEFAULT_AGENT_ID)) {
    systemAgents = [
      cloneAgentPreset(DEFAULT_AGENT_PRESETS[0]!),
      ...systemAgents,
    ];
  }

  // Scrub legacy bunx/npx on adapters
  systemAgents = scrubLegacyBunxCommands({
    version: 1,
    defaultAgentId: DEFAULT_AGENT_ID,
    agents: systemAgents,
  }).agents;

  const defaultAgentId = systemAgents.some(
    (a) => a.id === v1.config.defaultAgentId,
  )
    ? v1.config.defaultAgentId
    : DEFAULT_AGENT_ID;

  return {
    ok: true,
    document: {
      version: 2,
      mode: "off",
      defaultAgentId,
      systemAgents,
      overlay: [],
    },
  };
}

export function validatePersistedDocument(
  value: unknown,
): AgentsPersistedValidation {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "配置根节点必须是对象" };
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 2) {
    return { ok: false, error: "version 必须为 2" };
  }
  if (
    record.mode !== "off" &&
    record.mode !== "extend" &&
    record.mode !== "replace"
  ) {
    return { ok: false, error: "mode 必须是 off | extend | replace" };
  }
  if (!Array.isArray(record.systemAgents)) {
    return { ok: false, error: "systemAgents 必须是数组" };
  }
  if (!Array.isArray(record.overlay)) {
    return { ok: false, error: "overlay 必须是数组" };
  }

  const systemAgents: AgentPreset[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < record.systemAgents.length; i++) {
    const parsed = parseAgentPreset(record.systemAgents[i], i);
    if (typeof parsed === "string") {
      return { ok: false, error: `systemAgents: ${parsed}` };
    }
    if (seen.has(parsed.id)) {
      return { ok: false, error: `重复的 system Agent id: ${parsed.id}` };
    }
    seen.add(parsed.id);
    systemAgents.push(parsed);
  }
  if (systemAgents.length === 0) {
    systemAgents.push(cloneAgentPreset(DEFAULT_AGENT_PRESETS[0]!));
  }

  const overlay: AgentOverlayEntry[] = [];
  const overlaySeen = new Set<string>();
  for (let i = 0; i < record.overlay.length; i++) {
    const parsed = parseOverlayEntry(record.overlay[i], i);
    if (typeof parsed === "string") {
      return { ok: false, error: `overlay: ${parsed}` };
    }
    if (overlaySeen.has(parsed.id)) {
      return { ok: false, error: `重复的 overlay Agent id: ${parsed.id}` };
    }
    overlaySeen.add(parsed.id);
    overlay.push(parsed);
  }

  let defaultAgentId = DEFAULT_AGENT_ID;
  if (record.defaultAgentId !== undefined && record.defaultAgentId !== null) {
    if (!isNonEmptyString(record.defaultAgentId)) {
      return { ok: false, error: "defaultAgentId 必须是非空字符串" };
    }
    defaultAgentId = record.defaultAgentId.trim();
  }

  return {
    ok: true,
    document: {
      version: 2,
      mode: record.mode,
      defaultAgentId,
      systemAgents,
      overlay,
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

export function parseOverlayJson(text: string): AgentsOverlayValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `JSON 语法错误: ${message}` };
  }
  // Accept v1 full document as replace-style overlay (all fields required as presets).
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as { version?: unknown }).version === 1
  ) {
    const v1 = validateAgentsConfig(parsed);
    if (!v1.ok) return { ok: false, error: v1.error };
    return {
      ok: true,
      document: {
        version: 2,
        mode: "replace",
        defaultAgentId: v1.config.defaultAgentId,
        agents: v1.config.agents.map((a) => ({
          id: a.id,
          name: a.name,
          command: [...a.command],
          ...(a.registryId ? { registryId: a.registryId } : {}),
        })),
      },
    };
  }
  return validateOverlayDocument(parsed);
}

export function formatAgentsConfig(config: AgentsConfigDocument): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function formatOverlayDocument(doc: AgentsOverlayDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Build an extend-mode overlay draft from current system agents (empty patches). */
export function emptyExtendOverlayDraft(
  defaultAgentId: string,
): AgentsOverlayDocument {
  return {
    version: 2,
    mode: "extend",
    defaultAgentId,
    agents: [],
  };
}

/** Snapshot effective config as replace-mode overlay seed. */
export function effectiveToReplaceOverlay(
  effective: AgentsConfigDocument,
): AgentsOverlayDocument {
  return {
    version: 2,
    mode: "replace",
    defaultAgentId: effective.defaultAgentId,
    agents: effective.agents.map((a) => ({
      id: a.id,
      name: a.name,
      command: [...a.command],
      ...(a.registryId ? { registryId: a.registryId } : {}),
    })),
  };
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

export function cloneOverlayEntry(entry: AgentOverlayEntry): AgentOverlayEntry {
  return {
    id: entry.id,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(entry.command ? { command: [...entry.command] } : {}),
    ...(entry.registryId ? { registryId: entry.registryId } : {}),
    ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
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

export function clonePersistedDocument(
  doc: AgentsPersistedDocument = defaultPersistedDocument(),
): AgentsPersistedDocument {
  return {
    version: 2,
    mode: doc.mode,
    defaultAgentId: doc.defaultAgentId,
    systemAgents: doc.systemAgents.map(cloneAgentPreset),
    overlay: doc.overlay.map(cloneOverlayEntry),
  };
}

export function scrubLegacyBunxCommands(
  config: AgentsConfigDocument,
): AgentsConfigDocument {
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
