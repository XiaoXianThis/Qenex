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

/** Flatten ACP select options (flat list or grouped). */
export function flattenAcpSelectOptions(options: unknown): SelectOption[] {
  if (!Array.isArray(options)) return [];
  const out: SelectOption[] = [];
  for (const item of options) {
    if (!isRecord(item)) continue;
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
      continue;
    }
    if (Array.isArray(item.options)) {
      out.push(...flattenAcpSelectOptions(item.options));
    }
  }
  return out;
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
          return { modelId, name };
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
    "reasoning",
    "thinking",
    "effort",
  ]);
  const fastOpt = findConfigOption(session.configOptions, [
    "fast",
    "fast_mode",
    "speed",
  ]);

  return {
    modes: legacyModes ?? modesFromConfigOption(modeOpt),
    models: legacyModels ?? modelsFromConfigOption(modelOpt),
    thoughtLevels: thoughtFromConfigOption(thoughtOpt),
    fastOptions: thoughtFromConfigOption(fastOpt),
  };
}
