import type { NormalizedAcpSessionConfig } from "../../acp-session-config.ts";
import {
  restrictThoughtState,
  splitThinkingToggleFromThought,
  splitCartesianModelId,
  stripEffortFromModelName,
} from "../../acp-session-config.ts";
import { classifyGenericAgentError } from "./generic-acp.ts";
import type { AgentCompat } from "./types.ts";

/**
 * Codex advertises model×effort cartesian ids (`gpt-5.6-sol[high]`) plus
 * `reasoning_effort`. Collapse to canonical models; keep thought/fast pickers
 * per canonical model (never a global union of ultra + xhigh).
 */
export function normalizeCodexCatalog(
  cfg: NormalizedAcpSessionConfig,
): NormalizedAcpSessionConfig {
  const available = cfg.models?.availableModels ?? [];
  if (available.length === 0) return cfg;

  const canonicalOrder: string[] = [];
  const byCanonical = new Map<
    string,
    { name: string; description?: string; efforts: string[] }
  >();
  let sawVariant = false;

  for (const model of available) {
    const split = splitCartesianModelId(model.modelId);
    if (!split) {
      if (!byCanonical.has(model.modelId)) {
        canonicalOrder.push(model.modelId);
        byCanonical.set(model.modelId, {
          name: model.name?.trim() || model.modelId,
          description: model.description,
          efforts: [],
        });
      }
      continue;
    }
    sawVariant = true;
    const { canonicalId, effort } = split;
    let entry = byCanonical.get(canonicalId);
    if (!entry) {
      canonicalOrder.push(canonicalId);
      entry = {
        name: stripEffortFromModelName(
          model.name?.trim() || canonicalId,
          effort,
        ),
        description: model.description,
        efforts: [],
      };
      byCanonical.set(canonicalId, entry);
    }
    if (!entry.efforts.includes(effort)) entry.efforts.push(effort);
  }

  if (!sawVariant) return cfg;

  const currentSplit = cfg.models?.currentModelId
    ? splitCartesianModelId(cfg.models.currentModelId)
    : null;
  const currentModelId =
    currentSplit?.canonicalId ??
    (cfg.models?.currentModelId && byCanonical.has(cfg.models.currentModelId)
      ? cfg.models.currentModelId
      : canonicalOrder[0]);
  const currentEntry = currentModelId
    ? byCanonical.get(currentModelId)
    : undefined;

  const thoughtLevels = restrictThoughtState(
    cfg.thoughtLevels,
    currentEntry?.efforts ?? [],
    currentSplit?.effort ?? cfg.thoughtLevels?.currentId,
    cfg.thoughtLevels?.configId ?? "reasoning_effort",
  );

  const modelConfigById: NonNullable<
    NormalizedAcpSessionConfig["modelConfigById"]
  > = { ...cfg.modelConfigById };
  for (const [modelId, entry] of byCanonical) {
    const thought = restrictThoughtState(
      cfg.thoughtLevels,
      entry.efforts,
      modelId === currentModelId ? currentSplit?.effort : undefined,
      cfg.thoughtLevels?.configId ?? "reasoning_effort",
    );
    if (thought || cfg.fastOptions || cfg.thinkingOptions || cfg.contextOptions) {
      const split = splitThinkingToggleFromThought({
        thoughtLevels: thought,
        thinkingOptions: cfg.thinkingOptions,
      });
      modelConfigById[modelId] = {
        thoughtLevels: split.thoughtLevels,
        fastOptions: cfg.fastOptions,
        thinkingOptions: split.thinkingOptions,
        contextOptions: cfg.contextOptions,
      };
    }
  }

  const splitCurrent = splitThinkingToggleFromThought({
    thoughtLevels: thoughtLevels ?? cfg.thoughtLevels,
    thinkingOptions: cfg.thinkingOptions,
  });

  return {
    ...cfg,
    models: {
      currentModelId,
      availableModels: canonicalOrder.map((modelId) => {
        const entry = byCanonical.get(modelId)!;
        return {
          modelId,
          name: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
        };
      }),
    },
    thoughtLevels: splitCurrent.thoughtLevels,
    thinkingOptions: splitCurrent.thinkingOptions,
    modelConfigById:
      Object.keys(modelConfigById).length > 0 ? modelConfigById : undefined,
  };
}

export const codexCompat: AgentCompat = {
  id: "codex-acp",
  configDiscovery: "advertised",
  resume: "native-load",
  normalizeCatalog: normalizeCodexCatalog,
  classifyError: (error, phase) =>
    classifyGenericAgentError(error, phase, "codex-acp"),
};
