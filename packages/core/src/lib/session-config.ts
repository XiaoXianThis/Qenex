import type { AuthMethodInfo } from "./bridge-client.ts";

export type { AuthMethodInfo };

export type SessionOption = {
  id: string;
  name: string;
  description?: string;
};

/** Structured auth challenge when ACP requires login before session/new. */
export type AuthChallenge = {
  detail: string;
  /** May be empty when Bridge has not advertised login methods yet. */
  methods: AuthMethodInfo[];
  agentName?: string | null;
};

export type SessionConfig = {
  modes: SessionOption[];
  models: SessionOption[];
  thoughtLevels: SessionOption[];
  fastOptions: SessionOption[];
  contextOptions: SessionOption[];
  thinkingOptions: SessionOption[];
  currentModeId: string | null;
  currentModelId: string | null;
  currentThoughtLevelId: string | null;
  thoughtLevelConfigId: string | null;
  currentFastId: string | null;
  fastConfigId: string | null;
  currentContextId: string | null;
  contextConfigId: string | null;
  currentThinkingId: string | null;
  thinkingConfigId: string | null;
  modelConfigs?: Record<string, ModelConfigAxes>;
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** Present when spawn failed with ACP auth_required. */
  authChallenge: AuthChallenge | null;
  /** Agent reports native session resume; UI does not branch on agent id. */
  nativeResume?: boolean;
};

export type ModelConfigAxes = {
  thoughtLevels: SessionOption[];
  fastOptions: SessionOption[];
  contextOptions: SessionOption[];
  thinkingOptions: SessionOption[];
  thoughtLevelConfigId: string | null;
  currentThoughtLevelId: string | null;
  fastConfigId: string | null;
  currentFastId: string | null;
  contextConfigId: string | null;
  currentContextId: string | null;
  thinkingConfigId: string | null;
  currentThinkingId: string | null;
};

export const EMPTY_SESSION_CONFIG: SessionConfig = {
  modes: [],
  models: [],
  thoughtLevels: [],
  fastOptions: [],
  contextOptions: [],
  thinkingOptions: [],
  currentModeId: null,
  currentModelId: null,
  currentThoughtLevelId: null,
  thoughtLevelConfigId: null,
  currentFastId: null,
  fastConfigId: null,
  currentContextId: null,
  contextConfigId: null,
  currentThinkingId: null,
  thinkingConfigId: null,
  ready: false,
  loading: false,
  error: null,
  authChallenge: null,
};

export function parseSessionOptions(value: unknown): SessionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): SessionOption | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = String(record.id ?? record.value ?? "");
      const name = String(record.name ?? record.label ?? id);
      if (!id) {
        return null;
      }
      const description =
        typeof record.description === "string" ? record.description : undefined;
      return description ? { id, name, description } : { id, name };
    })
    .filter((item): item is SessionOption => item !== null);
}

export function optionLabel(
  options: SessionOption[],
  currentId: string | null,
  fallback = "默认",
): string {
  if (!currentId) {
    return options[0]?.name ?? fallback;
  }
  return options.find((option) => option.id === currentId)?.name ?? currentId;
}

const THOUGHT_OFF_IDS = new Set(["none", "off", "disabled"]);

export function isThoughtOffOptionId(id: string | null | undefined): boolean {
  if (!id) return false;
  return THOUGHT_OFF_IDS.has(id.trim().toLowerCase());
}

/**
 * Cursor often advertises thinking-off as `none` inside the effort list.
 * Split that into a toggle so intensity stays selectable. Mirrors Bridge.
 */
export function splitThinkingToggleFromCachedOptions(input: {
  thoughtLevels: SessionOption[];
  thinkingOptions?: SessionOption[];
  currentThoughtLevelId?: string | null;
  currentThinkingId?: string | null;
}): {
  thoughtLevels: SessionOption[];
  thinkingOptions: SessionOption[];
  currentThoughtLevelId: string | null;
  currentThinkingId: string | null;
} {
  const thought = input.thoughtLevels;
  const existingThinking = input.thinkingOptions ?? [];
  const off = thought.filter((option) => isThoughtOffOptionId(option.id));
  const intensity = thought.filter((option) => !isThoughtOffOptionId(option.id));
  if (off.length === 0 || intensity.length === 0) {
    return {
      thoughtLevels: thought,
      thinkingOptions: existingThinking,
      currentThoughtLevelId: input.currentThoughtLevelId ?? null,
      currentThinkingId: input.currentThinkingId ?? null,
    };
  }
  const offOption = off[0]!;
  const currentThought = input.currentThoughtLevelId ?? null;
  const currentIsOff = isThoughtOffOptionId(currentThought);
  const onId =
    (!currentIsOff &&
      currentThought &&
      intensity.some((option) => option.id === currentThought) &&
      currentThought) ||
    intensity[0]!.id;
  const thinkingOptions =
    existingThinking.length > 0
      ? existingThinking
      : [
          { id: offOption.id, name: offOption.name || "Off" },
          { id: onId, name: "On" },
        ];
  const currentThoughtLevelId = currentIsOff
    ? intensity[0]!.id
    : currentThought && intensity.some((option) => option.id === currentThought)
      ? currentThought
      : intensity[0]!.id;
  const currentThinkingId =
    input.currentThinkingId &&
    thinkingOptions.some((option) => option.id === input.currentThinkingId)
      ? input.currentThinkingId
      : currentIsOff
        ? offOption.id
        : (thinkingOptions.find((option) => !isThoughtOffOptionId(option.id))?.id ??
          onId);
  return {
    thoughtLevels: intensity,
    thinkingOptions,
    currentThoughtLevelId,
    currentThinkingId,
  };
}

/** Empty thought/fast/context/thinking snapshots are not a cache hit. */
export function hasModelConfigOptions(snapshot: {
  thoughtLevels: SessionOption[];
  fastOptions: SessionOption[];
  contextOptions?: SessionOption[];
  thinkingOptions?: SessionOption[];
}): boolean {
  return (
    snapshot.thoughtLevels.length > 0 ||
    snapshot.fastOptions.length > 0 ||
    (snapshot.contextOptions?.length ?? 0) > 0 ||
    (snapshot.thinkingOptions?.length ?? 0) > 0
  );
}

/**
 * Apply agent-level preferred model/mode/thought only on the create path.
 * Resume / existing sessions keep the ACP snapshot.
 */
export function shouldApplyPreferredSessionConfig(isNewSession: boolean): boolean {
  return isNewSession;
}

/** Preferred id if it exists in the catalog and differs from current. */
export function preferredCatalogId(
  preferred: string | null | undefined,
  current: string | null | undefined,
  options: SessionOption[],
): string | null {
  if (!preferred || preferred === current) return null;
  return options.some((option) => option.id === preferred) ? preferred : null;
}

export function planNewSessionBootstrapActions(input: {
  isNewSession: boolean;
  currentModeId: string | null;
  currentModelId: string | null;
  modes: SessionOption[];
  models: SessionOption[];
  preferredMode: string | null;
  preferredModel: string | null;
}): { setMode: string | null; setModel: string | null } {
  if (!shouldApplyPreferredSessionConfig(input.isNewSession)) {
    return { setMode: null, setModel: null };
  }
  return {
    setMode: preferredCatalogId(
      input.preferredMode,
      input.currentModeId,
      input.modes,
    ),
    setModel: preferredCatalogId(
      input.preferredModel,
      input.currentModelId,
      input.models,
    ),
  };
}

export function planPreferredThoughtFastActions(input: {
  applyPreferred: boolean;
  thoughtLevels: SessionOption[];
  fastOptions: SessionOption[];
  thoughtLevelConfigId: string | null;
  fastConfigId: string | null;
  currentThoughtLevelId: string | null;
  currentFastId: string | null;
  preferredThought: string | null;
  preferredFast: string | null;
}): {
  setThought: { configId: string; value: string } | null;
  setFast: { configId: string; value: string } | null;
} {
  if (!input.applyPreferred) {
    return { setThought: null, setFast: null };
  }
  const setThought =
    input.preferredThought &&
    input.thoughtLevelConfigId &&
    input.preferredThought !== input.currentThoughtLevelId &&
    input.thoughtLevels.some((level) => level.id === input.preferredThought)
      ? {
          configId: input.thoughtLevelConfigId,
          value: input.preferredThought,
        }
      : null;
  const setFast =
    input.preferredFast &&
    input.fastConfigId &&
    input.preferredFast !== input.currentFastId &&
    input.fastOptions.some((option) => option.id === input.preferredFast)
      ? { configId: input.fastConfigId, value: input.preferredFast }
      : null;
  return { setThought, setFast };
}

export function hasCachedModelConfigRow(
  modelId: string,
  maps: Array<Record<string, SessionOption[]>>,
): boolean {
  return maps.some((map) =>
    Object.prototype.hasOwnProperty.call(map, modelId),
  );
}

/**
 * Gear / row fetch: skip only when this model already has a cache row, or it
 * is the current model and live options are already on the session.
 * Never treat another model's missing row as "use live thought".
 */
export function shouldSkipModelConfigFetch(input: {
  modelId: string;
  currentModelId: string | null;
  maps: Array<Record<string, SessionOption[]>>;
  liveHasOptions: boolean;
}): boolean {
  if (hasCachedModelConfigRow(input.modelId, input.maps)) return true;
  return input.modelId === input.currentModelId && input.liveHasOptions;
}

/** Visible, uncached rows only — never a full-catalog probe. */
export function modelIdsNeedingConfigPrefetch(input: {
  visibleModelIds: string[];
  thoughtLevelsByModel: Record<string, SessionOption[]>;
  fastOptionsByModel: Record<string, SessionOption[]>;
  contextOptionsByModel?: Record<string, SessionOption[]>;
  thinkingOptionsByModel?: Record<string, SessionOption[]>;
}): string[] {
  const maps = [
    input.thoughtLevelsByModel,
    input.fastOptionsByModel,
    input.contextOptionsByModel ?? {},
    input.thinkingOptionsByModel ?? {},
  ];
  return input.visibleModelIds.filter(
    (modelId) => !hasCachedModelConfigRow(modelId, maps),
  );
}

/**
 * Per-model cache wins (empty array = known no options). Live options apply
 * only to the current model — never copied onto other rows.
 */
export function displayOptionsForModel<T>(input: {
  modelId: string;
  currentModelId: string | null;
  live: T[];
  byModel: Record<string, T[]>;
}): T[] | null {
  if (Object.prototype.hasOwnProperty.call(input.byModel, input.modelId)) {
    return input.byModel[input.modelId] ?? [];
  }
  if (input.modelId === input.currentModelId && input.live.length > 0) {
    return input.live;
  }
  return null;
}

/** Trigger label: live first, then the current model's cached levels. */
export function triggerOptionsForModel<T>(input: {
  live: T[];
  currentModelId: string | null;
  byModel: Record<string, T[]>;
}): T[] {
  if (input.live.length > 0) return input.live;
  if (
    input.currentModelId &&
    Object.prototype.hasOwnProperty.call(input.byModel, input.currentModelId)
  ) {
    return input.byModel[input.currentModelId] ?? [];
  }
  return [];
}
