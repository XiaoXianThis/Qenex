/**
 * Normalize SessionInfo → session config DTO for GET/POST mode|model.
 * Non-empty lists mean the session has modes/models/thought/fast.
 * nativeResume cannot be inferred from lists.
 */
import { resolveAgentCompat } from "./agent/compat/registry.ts";
import type { AcpModelAxes, AcpThoughtState } from "./acp-session-config.ts";
import type { SessionInfo } from "./session-store.ts";

export type SessionOptionDto = {
  id: string;
  name: string;
  description?: string;
};

export type ModelConfigAxesDto = {
  thoughtLevels: SessionOptionDto[];
  fastOptions: SessionOptionDto[];
  contextOptions: SessionOptionDto[];
  thinkingOptions: SessionOptionDto[];
  thoughtLevelConfigId: string | null;
  currentThoughtLevelId: string | null;
  fastConfigId: string | null;
  currentFastId: string | null;
  contextConfigId: string | null;
  currentContextId: string | null;
  thinkingConfigId: string | null;
  currentThinkingId: string | null;
};

export type SessionConfigDto = {
  sessionId: string;
  modes: SessionOptionDto[];
  models: SessionOptionDto[];
  currentModeId: string | null;
  currentModelId: string | null;
  thoughtLevels: SessionOptionDto[];
  fastOptions: SessionOptionDto[];
  contextOptions: SessionOptionDto[];
  thinkingOptions: SessionOptionDto[];
  thoughtLevelConfigId: string | null;
  currentThoughtLevelId: string | null;
  fastConfigId: string | null;
  currentFastId: string | null;
  contextConfigId: string | null;
  currentContextId: string | null;
  thinkingConfigId: string | null;
  currentThinkingId: string | null;
  /** Advertised per-canonical-model axes (cartesian). Not a probe. */
  modelConfigs?: Record<string, ModelConfigAxesDto>;
  /** True when the current AgentCompat resume strategy is native-load. */
  nativeResume?: boolean;
};

function mapOptions(
  available: Array<{ id: string; name: string; description?: string }> | undefined,
): SessionOptionDto[] {
  return (available ?? []).map((item) => ({
    id: item.id,
    name: (item.name && item.name.trim()) || item.id,
    ...(item.description ? { description: item.description } : {}),
  }));
}

function axesFromThought(
  state: AcpThoughtState | undefined,
): {
  options: SessionOptionDto[];
  configId: string | null;
  currentId: string | null;
} {
  const options = mapOptions(state?.available);
  return {
    options,
    configId: state?.configId ?? null,
    currentId: state?.currentId ?? options[0]?.id ?? null,
  };
}

export function modelAxesToDto(axes: AcpModelAxes): ModelConfigAxesDto {
  const thought = axesFromThought(axes.thoughtLevels);
  const fast = axesFromThought(axes.fastOptions);
  const context = axesFromThought(axes.contextOptions);
  const thinking = axesFromThought(axes.thinkingOptions);
  return {
    thoughtLevels: thought.options,
    fastOptions: fast.options,
    contextOptions: context.options,
    thinkingOptions: thinking.options,
    thoughtLevelConfigId: thought.configId,
    currentThoughtLevelId: thought.currentId,
    fastConfigId: fast.configId,
    currentFastId: fast.currentId,
    contextConfigId: context.configId,
    currentContextId: context.currentId,
    thinkingConfigId: thinking.configId,
    currentThinkingId: thinking.currentId,
  };
}

export function overlayDtoWithModelAxes(
  live: SessionConfigDto,
  axes: AcpModelAxes,
  modelId: string,
): SessionConfigDto & { modelId: string } {
  const overlay = modelAxesToDto(axes);
  return {
    ...live,
    currentModelId: modelId,
    thoughtLevels: overlay.thoughtLevels,
    fastOptions: overlay.fastOptions,
    contextOptions: overlay.contextOptions,
    thinkingOptions: overlay.thinkingOptions,
    thoughtLevelConfigId: overlay.thoughtLevelConfigId ?? live.thoughtLevelConfigId,
    currentThoughtLevelId: overlay.currentThoughtLevelId,
    fastConfigId: overlay.fastConfigId ?? live.fastConfigId,
    currentFastId: overlay.currentFastId,
    contextConfigId: overlay.contextConfigId ?? live.contextConfigId,
    currentContextId: overlay.currentContextId,
    thinkingConfigId: overlay.thinkingConfigId ?? live.thinkingConfigId,
    currentThinkingId: overlay.currentThinkingId,
    modelId,
  };
}

export function sessionInfoToConfigDto(info: SessionInfo): SessionConfigDto {
  const modes = (info.modes?.availableModes ?? [])
    .filter((m) => typeof m.id === "string" && m.id.length > 0)
    .map((m) => ({
      id: m.id,
      name: (m.name && m.name.trim()) || m.id,
      ...(m.description ? { description: m.description } : {}),
    }));

  const models = (info.models?.availableModels ?? [])
    .filter((m) => typeof m.modelId === "string" && m.modelId.length > 0)
    .map((m) => ({
      id: m.modelId,
      name: (m.name && m.name.trim()) || m.modelId,
      ...(m.description ? { description: m.description } : {}),
    }));

  const thought = axesFromThought(info.thoughtLevels);
  const fast = axesFromThought(info.fastOptions);
  const context = axesFromThought(info.contextOptions);
  const thinking = axesFromThought(info.thinkingOptions);

  const modelConfigs = info.modelConfigById
    ? Object.fromEntries(
        Object.entries(info.modelConfigById).map(([modelId, axes]) => [
          modelId,
          modelAxesToDto(axes),
        ]),
      )
    : undefined;

  return {
    sessionId: info.sessionId,
    modes,
    models,
    currentModeId: info.modes?.currentModeId ?? modes[0]?.id ?? null,
    currentModelId: info.models?.currentModelId ?? models[0]?.id ?? null,
    thoughtLevels: thought.options,
    fastOptions: fast.options,
    contextOptions: context.options,
    thinkingOptions: thinking.options,
    thoughtLevelConfigId: thought.configId,
    currentThoughtLevelId: thought.currentId,
    fastConfigId: fast.configId,
    currentFastId: fast.currentId,
    contextConfigId: context.configId,
    currentContextId: context.currentId,
    thinkingConfigId: thinking.configId,
    currentThinkingId: thinking.currentId,
    ...(modelConfigs && Object.keys(modelConfigs).length > 0
      ? { modelConfigs }
      : {}),
    nativeResume: resolveAgentCompat(info.agent).resume === "native-load",
  };
}
