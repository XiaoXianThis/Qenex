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

/** Per-model thought / fast / context / thinking-toggle snapshot. */
export type AcpModelAxes = {
  thoughtLevels?: AcpThoughtState;
  fastOptions?: AcpThoughtState;
  contextOptions?: AcpThoughtState;
  thinkingOptions?: AcpThoughtState;
};

export type NormalizedAcpSessionConfig = {
  modes?: AcpModeState;
  models?: AcpModelState;
  thoughtLevels?: AcpThoughtState;
  fastOptions?: AcpThoughtState;
  contextOptions?: AcpThoughtState;
  /** Independent thinking on/off when advertised separately from intensity. */
  thinkingOptions?: AcpThoughtState;
  /** Cartesian / advertised axes keyed by canonical model id. */
  modelConfigById?: Record<string, AcpModelAxes>;
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

export const EFFORT_SORT_ORDER = [
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
  "ultra",
] as const;

const THINKING_MODE_IDS = new Set<string>(EFFORT_SORT_ORDER);

const BOOLEAN_OPTION_IDS = new Set([
  "true",
  "false",
  "on",
  "off",
  "1",
  "0",
  "yes",
  "no",
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
  ultra: "Ultra",
};

export function sortEffortIds(ids: string[]): string[] {
  const order = EFFORT_SORT_ORDER as readonly string[];
  return [...ids].sort((a, b) => {
    const ia = order.indexOf(a.toLowerCase());
    const ib = order.indexOf(b.toLowerCase());
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function isBooleanLikeOptions(
  options: Array<{ id: string }>,
): boolean {
  if (options.length === 0 || options.length > 2) return false;
  return options.every((option) =>
    BOOLEAN_OPTION_IDS.has(option.id.trim().toLowerCase()),
  );
}

export function restrictThoughtState(
  base: AcpThoughtState | undefined,
  ids: string[],
  currentId?: string,
  configIdFallback = "reasoning",
): AcpThoughtState | undefined {
  const unique = sortEffortIds([...new Set(ids.filter(Boolean))]);
  if (unique.length === 0) return undefined;
  if (base) {
    const allowed = new Set(unique);
    const byId = new Map(base.available.map((option) => [option.id, option]));
    const available = unique.map(
      (id) => byId.get(id) ?? { id, name: effortDisplayName(id) },
    );
    const current =
      (currentId && allowed.has(currentId) && currentId) ||
      (base.currentId && allowed.has(base.currentId) && base.currentId) ||
      available[0]?.id;
    return {
      configId: base.configId,
      currentId: current,
      available,
    };
  }
  return thoughtStateFromIds(configIdFallback, currentId, unique);
}

export function thoughtStateFromIds(
  configId: string,
  currentId: string | undefined,
  ids: string[],
  nameFor = effortDisplayName,
): AcpThoughtState | undefined {
  const available = sortEffortIds([...new Set(ids.filter(Boolean))]).map(
    (id) => ({
      id,
      name: nameFor(id),
    }),
  );
  if (available.length === 0) return undefined;
  const current =
    currentId && available.some((option) => option.id === currentId)
      ? currentId
      : available[0]?.id;
  return { configId, currentId: current, available };
}

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

/** `contextLength` / `context-length` / `Context Length` → `context_length`. */
export function normalizeConfigKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function findConfigOption(
  configOptions: unknown,
  aliases: string[],
): Record<string, unknown> | null {
  if (!Array.isArray(configOptions)) return null;
  const keys = new Set(aliases.map(normalizeConfigKey));
  const found = configOptions.find((option) => {
    if (!isRecord(option)) return false;
    return [option.category, option.id, option.configId, option.name].some(
      (value) => keys.has(normalizeConfigKey(value)),
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

function configOptionId(opt: Record<string, unknown>): string {
  if (typeof opt.id === "string" && opt.id.trim()) return opt.id.trim();
  if (typeof opt.configId === "string" && opt.configId.trim()) {
    return opt.configId.trim();
  }
  return "";
}

function thoughtCurrentId(opt: Record<string, unknown>): string | undefined {
  if (typeof opt.currentValue === "string") return opt.currentValue;
  if (typeof opt.currentValue === "boolean") return String(opt.currentValue);
  return undefined;
}

function thoughtFromConfigOption(
  opt: Record<string, unknown> | null,
): AcpThoughtState | undefined {
  if (!opt) return undefined;
  const id = configOptionId(opt);
  if (!id) return undefined;
  const available = flattenAcpSelectOptions(opt.options);
  if (available.length === 0) return undefined;
  return {
    configId: id,
    currentId: thoughtCurrentId(opt),
    available,
  };
}

const THOUGHT_INTENSITY_ALIASES = [
  "thought_level",
  "thinking_level",
  "reasoning_effort",
  "reasoning_level",
  "reasoning",
  "thought",
  "think",
  "think_level",
  "effort",
];

const THINKING_TOGGLE_ALIASES = [
  "thinking_enabled",
  "think_enabled",
  "enable_thinking",
  "thinking_toggle",
  "use_thinking",
];

const CONTEXT_ALIASES = [
  "context",
  "context_length",
  "context_window",
  "context_window_size",
  "context_size",
  "max_context",
  "ctx",
];

const THOUGHT_OFF_IDS = new Set(["none", "off", "disabled"]);

export function isThoughtOffId(id: string | null | undefined): boolean {
  if (!id) return false;
  return THOUGHT_OFF_IDS.has(id.trim().toLowerCase());
}

/**
 * Cursor/OpenCode often advertise thinking-off as `none` inside the effort
 * list. Split that into an independent toggle so intensity stays selectable.
 */
export function splitThinkingToggleFromThought(input: {
  thoughtLevels?: AcpThoughtState;
  thinkingOptions?: AcpThoughtState;
}): {
  thoughtLevels?: AcpThoughtState;
  thinkingOptions?: AcpThoughtState;
} {
  const thought = input.thoughtLevels;
  if (!thought) return input;
  const off = thought.available.filter((option) => isThoughtOffId(option.id));
  const intensity = thought.available.filter(
    (option) => !isThoughtOffId(option.id),
  );
  if (off.length === 0 || intensity.length === 0) {
    return input;
  }
  const offId = off[0]!.id;
  const currentIsOff = isThoughtOffId(thought.currentId);
  const onId =
    (!currentIsOff &&
      thought.currentId &&
      intensity.some((option) => option.id === thought.currentId) &&
      thought.currentId) ||
    intensity[0]!.id;
  const thinkingOptions =
    input.thinkingOptions ??
    ({
      configId: thought.configId,
      currentId: currentIsOff ? offId : onId,
      available: [
        { id: offId, name: off[0]!.name || "Off" },
        { id: onId, name: "On" },
      ],
    } satisfies AcpThoughtState);
  if (
    !input.thinkingOptions &&
    intensity.length === 1 &&
    isBooleanLikeOptions(intensity)
  ) {
    return { thoughtLevels: undefined, thinkingOptions };
  }
  const thoughtLevels: AcpThoughtState = {
    configId: thought.configId,
    currentId: currentIsOff
      ? intensity[0]!.id
      : thought.currentId &&
          intensity.some((option) => option.id === thought.currentId)
        ? thought.currentId
        : intensity[0]!.id,
    available: intensity,
  };
  return { thoughtLevels, thinkingOptions };
}

/**
 * Prefer legacy `modes`/`models`; fall back to `configOptions` categories
 * `mode` / `model` / `thought_level` (OpenCode ACP today).
 * Intensity and thinking-toggle are distinct when both are advertised.
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
  const thoughtOpt = findConfigOption(
    session.configOptions,
    THOUGHT_INTENSITY_ALIASES,
  );
  const thinkingToggleOpt = findConfigOption(
    session.configOptions,
    THINKING_TOGGLE_ALIASES,
  );
  const thinkingAmbiguous = findConfigOption(session.configOptions, [
    "thinking",
  ]);
  const fastOpt = findConfigOption(session.configOptions, [
    "fast",
    "fast_mode",
    "fastmode",
    "speed",
  ]);
  const contextOpt = findConfigOption(session.configOptions, CONTEXT_ALIASES);

  let thoughtLevels = thoughtFromConfigOption(thoughtOpt);
  let thinkingOptions = thoughtFromConfigOption(thinkingToggleOpt);
  if (
    thoughtLevels &&
    isBooleanLikeOptions(thoughtLevels.available) &&
    !thinkingOptions
  ) {
    thinkingOptions = thoughtLevels;
    thoughtLevels = undefined;
  }
  const ambiguous = thoughtFromConfigOption(thinkingAmbiguous);
  if (ambiguous) {
    if (isBooleanLikeOptions(ambiguous.available)) {
      thinkingOptions = thinkingOptions ?? ambiguous;
    } else if (!thoughtLevels) {
      thoughtLevels = ambiguous;
    }
  }

  const split = splitThinkingToggleFromThought({
    thoughtLevels,
    thinkingOptions,
  });

  return {
    modes: legacyModes ?? modesFromConfigOption(modeOpt),
    models: legacyModels ?? modelsFromConfigOption(modelOpt),
    thoughtLevels: split.thoughtLevels,
    fastOptions: thoughtFromConfigOption(fastOpt),
    contextOptions: thoughtFromConfigOption(contextOpt),
    thinkingOptions: split.thinkingOptions,
  };
}
