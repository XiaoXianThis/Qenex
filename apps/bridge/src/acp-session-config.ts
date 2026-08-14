/**
 * Normalize ACP new/load session payloads into Bridge SessionInfo mode/model
 * shapes. Current OpenCode advertises mode/model via `configOptions` (not the
 * legacy unstable `modes` / `models` fields).
 */

export type AcpModeState = {
  currentModeId?: string;
  availableModes?: Array<{ id: string; name?: string; description?: string }>;
};

export type AcpModelState = {
  currentModelId?: string;
  availableModels?: Array<{
    modelId: string;
    name?: string;
    description?: string;
  }>;
};

export type AcpThoughtState = {
  configId: string;
  currentId?: string;
  available: Array<{ id: string; name: string; description?: string }>;
};

export type NormalizedAcpSessionConfig = {
  modes?: AcpModeState;
  models?: AcpModelState;
  thoughtLevels?: AcpThoughtState;
  fastOptions?: AcpThoughtState;
};

type SelectOption = {
  id: string;
  name: string;
  description?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Flatten ACP select options (flat list or grouped).
 * Nested `options` win over a group's own `value` so category headers are not
 * selectable model ids.
 */
export function flattenAcpSelectOptions(options: unknown): SelectOption[] {
  if (!Array.isArray(options)) return [];
  const out: SelectOption[] = [];
  for (const item of options) {
    if (!isRecord(item)) continue;
    if (Array.isArray(item.options) && item.options.length > 0) {
      out.push(...flattenAcpSelectOptions(item.options));
      continue;
    }
    if (typeof item.value === "string" && item.value.length > 0) {
      const name =
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : item.value;
      const description =
        typeof item.description === "string" ? item.description : undefined;
      out.push(
        description ? { id: item.value, name, description } : { id: item.value, name },
      );
    }
  }
  return out;
}

/** Synthetic thought configId: UI setConfigOption maps to session/set_mode. */
export const MODE_THOUGHT_CONFIG_ID = "mode";

const MODEL_EFFORT_RE = /^(.*)\[([^\]]+)\]$/;

export function splitCartesianModelId(
  modelId: string,
): { canonicalId: string; effort: string } | null {
  const match = modelId.match(MODEL_EFFORT_RE);
  if (!match) return null;
  const canonicalId = match[1]!.trim();
  const effort = match[2]!.trim();
  if (!canonicalId || !effort) return null;
  return { canonicalId, effort };
}

const THINKING_MODE_IDS = new Set([
  "off",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "extra-high",
  "extra_high",
  "max",
]);

const THINKING_NAME_RE = /^thinking\s*:/i;

export function isThinkingModeOption(id: string, name?: string): boolean {
  if (THINKING_NAME_RE.test(id) || THINKING_NAME_RE.test(name ?? "")) return true;
  return THINKING_MODE_IDS.has(id.trim().toLowerCase());
}

export function thinkingEffortFromMode(id: string, name?: string): string {
  const fromName = (name ?? "").replace(THINKING_NAME_RE, "").trim();
  if (fromName) return fromName.toLowerCase().replace(/\s+/g, "_");
  const fromId = id.replace(THINKING_NAME_RE, "").trim();
  return fromId.toLowerCase() || id;
}

const EFFORT_LABELS: Record<string, string> = {
  off: "Off",
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  extra_high: "Extra high",
  "extra-high": "Extra high",
  max: "Max",
};

export function effortDisplayName(effort: string, fallbackName?: string): string {
  const key = effort.trim().toLowerCase();
  if (EFFORT_LABELS[key]) return EFFORT_LABELS[key]!;
  const stripped = (fallbackName ?? "").replace(THINKING_NAME_RE, "").trim();
  if (stripped) return stripped;
  if (!effort) return fallbackName?.trim() || effort;
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function stripEffortFromModelName(name: string, effort: string): string {
  if (!name.trim()) return name;
  const escaped = effort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = name
    .replace(new RegExp(`\\s*\\(${escaped}\\)\\s*$`, "i"), "")
    .replace(new RegExp(`\\s*\\[${escaped}\\]\\s*$`, "i"), "")
    .replace(new RegExp(`\\s+${escaped}\\s*$`, "i"), "")
    .trim();
  return stripped || name.trim();
}

function normalizeConfigKey(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : "";
}

function findConfigOption(
  configOptions: unknown,
  aliases: string[],
): Record<string, unknown> | null {
  if (!Array.isArray(configOptions)) return null;
  const keys = new Set(aliases.map(normalizeConfigKey));
  const found = configOptions.find((option) => {
    if (!isRecord(option)) return false;
    return [option.category, option.id, option.name].some((value) =>
      keys.has(normalizeConfigKey(value)),
    );
  });
  return isRecord(found) ? found : null;
}

function modesFromLegacy(modes: unknown): AcpModeState | undefined {
  if (!isRecord(modes)) return undefined;
  const available = Array.isArray(modes.availableModes)
    ? modes.availableModes
        .filter((m): m is Record<string, unknown> => isRecord(m))
        .map((m) => {
          const id = typeof m.id === "string" ? m.id : "";
          if (!id) return null;
          const name = typeof m.name === "string" ? m.name : undefined;
          const description =
            typeof m.description === "string" ? m.description : undefined;
          return { id, name, description };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
    : [];
  if (available.length === 0) return undefined;
  return {
    currentModeId:
      typeof modes.currentModeId === "string" ? modes.currentModeId : undefined,
    availableModes: available,
  };
}

function modelsFromLegacy(models: unknown): AcpModelState | undefined {
  if (!isRecord(models)) return undefined;
  const available = Array.isArray(models.availableModels)
    ? models.availableModels
        .filter((m): m is Record<string, unknown> => isRecord(m))
        .map((m) => {
          const modelId = typeof m.modelId === "string" ? m.modelId : "";
          if (!modelId) return null;
          const name = typeof m.name === "string" ? m.name : undefined;
          const description =
            typeof m.description === "string" ? m.description : undefined;
          return { modelId, name, description };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
    : [];
  if (available.length === 0) return undefined;
  return {
    currentModelId:
      typeof models.currentModelId === "string"
        ? models.currentModelId
        : undefined,
    availableModels: available,
  };
}

function modesFromConfigOption(
  opt: Record<string, unknown> | null,
): AcpModeState | undefined {
  if (!opt) return undefined;
  const available = flattenAcpSelectOptions(opt.options);
  if (available.length === 0) return undefined;
  return {
    currentModeId:
      typeof opt.currentValue === "string" ? opt.currentValue : undefined,
    availableModes: available.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
    })),
  };
}

function modelsFromConfigOption(
  opt: Record<string, unknown> | null,
): AcpModelState | undefined {
  if (!opt) return undefined;
  const available = flattenAcpSelectOptions(opt.options);
  if (available.length === 0) return undefined;
  return {
    currentModelId:
      typeof opt.currentValue === "string" ? opt.currentValue : undefined,
    availableModels: available.map((o) => ({
      modelId: o.id,
      name: o.name,
      description: o.description,
    })),
  };
}

function thoughtFromConfigOption(
  opt: Record<string, unknown> | null,
): AcpThoughtState | undefined {
  if (!opt || typeof opt.id !== "string" || !opt.id) return undefined;
  const available = flattenAcpSelectOptions(opt.options);
  if (available.length === 0) return undefined;
  return {
    configId: opt.id,
    currentId:
      typeof opt.currentValue === "string" ? opt.currentValue : undefined,
    available,
  };
}

/**
 * Prefer legacy `modes`/`models`; fall back to `configOptions` categories
 * `mode` / `model` / `thought_level` (OpenCode ACP today).
 */
export function normalizeAcpSessionConfig(session: {
  modes?: unknown;
  models?: unknown;
  configOptions?: unknown;
}): NormalizedAcpSessionConfig {
  const legacyModes = modesFromLegacy(session.modes);
  const legacyModels = modelsFromLegacy(session.models);
  const modeOpt = findConfigOption(session.configOptions, ["mode"]);
  const modelOpt = findConfigOption(session.configOptions, ["model"]);
  const thoughtOpt = findConfigOption(session.configOptions, [
    "thought_level",
    "thinking_level",
    "reasoning_effort",
    "reasoning_level",
    "reasoning",
    "thinking",
    "thought",
    "think",
    "think_level",
    "effort",
  ]);
  const fastOpt = findConfigOption(session.configOptions, [
    "fast",
    "fast_mode",
    "fastmode",
    "speed",
  ]);

  return {
    modes: legacyModes ?? modesFromConfigOption(modeOpt),
    models: legacyModels ?? modelsFromConfigOption(modelOpt),
    thoughtLevels: thoughtFromConfigOption(thoughtOpt),
    fastOptions: thoughtFromConfigOption(fastOpt),
  };
}
