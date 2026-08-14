/**
 * Normalize SessionInfo → session config DTO for GET/POST mode|model.
 * Non-empty lists mean the session has modes/models/thought/fast.
 * nativeResume cannot be inferred from lists.
 */
import { resolveAgentCompat } from "./agent/compat/registry.ts";
import type { SessionInfo } from "./session-store.ts";

export type SessionConfigDto = {
  sessionId: string;
  modes: Array<{ id: string; name: string; description?: string }>;
  models: Array<{ id: string; name: string; description?: string }>;
  currentModeId: string | null;
  currentModelId: string | null;
  thoughtLevels: Array<{ id: string; name: string; description?: string }>;
  fastOptions: Array<{ id: string; name: string }>;
  thoughtLevelConfigId: string | null;
  currentThoughtLevelId: string | null;
  fastConfigId: string | null;
  currentFastId: string | null;
  /** True when the current AgentCompat resume strategy is native-load. */
  nativeResume?: boolean;
};

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

  const thoughtLevels = (info.thoughtLevels?.available ?? []).map((t) => ({
    id: t.id,
    name: (t.name && t.name.trim()) || t.id,
    ...(t.description ? { description: t.description } : {}),
  }));
  const fastOptions = (info.fastOptions?.available ?? []).map((option) => ({
    id: option.id,
    name: (option.name && option.name.trim()) || option.id,
  }));

  return {
    sessionId: info.sessionId,
    modes,
    models,
    currentModeId: info.modes?.currentModeId ?? modes[0]?.id ?? null,
    currentModelId: info.models?.currentModelId ?? models[0]?.id ?? null,
    thoughtLevels,
    fastOptions,
    thoughtLevelConfigId: info.thoughtLevels?.configId ?? null,
    currentThoughtLevelId:
      info.thoughtLevels?.currentId ?? thoughtLevels[0]?.id ?? null,
    fastConfigId: info.fastOptions?.configId ?? null,
    currentFastId: info.fastOptions?.currentId ?? fastOptions[0]?.id ?? null,
    nativeResume: resolveAgentCompat(info.agent).resume === "native-load",
  };
}
