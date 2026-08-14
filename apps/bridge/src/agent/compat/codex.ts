import type { NormalizedAcpSessionConfig } from "../../acp-session-config.ts";
import {
  effortDisplayName,
  splitCartesianModelId,
  stripEffortFromModelName,
} from "../../acp-session-config.ts";
import { classifyGenericAgentError } from "./generic-acp.ts";
import type { AgentCompat } from "./types.ts";

const EFFORT_ORDER = [
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
];

function sortEfforts(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ia = EFFORT_ORDER.indexOf(a.toLowerCase());
    const ib = EFFORT_ORDER.indexOf(b.toLowerCase());
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * Codex advertises model×effort cartesian ids (`gpt-5.6-sol[high]`) plus
 * `reasoning_effort`. Collapse to canonical models; keep thought/fast pickers.
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
  const seenEffort = new Set<string>();

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
    const { canonicalId, effort } = split;
    seenEffort.add(effort);
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

  if (seenEffort.size === 0) return cfg;

  const currentSplit = cfg.models?.currentModelId
    ? splitCartesianModelId(cfg.models.currentModelId)
    : null;
  const currentModelId =
    currentSplit?.canonicalId ??
    (cfg.models?.currentModelId && byCanonical.has(cfg.models.currentModelId)
      ? cfg.models.currentModelId
      : canonicalOrder[0]);

  let thoughtLevels = cfg.thoughtLevels;
  if (!thoughtLevels && seenEffort.size > 0) {
    const efforts = sortEfforts([...seenEffort]);
    thoughtLevels = {
      configId: "reasoning_effort",
      currentId: currentSplit?.effort ?? efforts[0],
      available: efforts.map((id) => ({
        id,
        name: effortDisplayName(id),
      })),
    };
  } else if (thoughtLevels && !thoughtLevels.currentId && currentSplit?.effort) {
    thoughtLevels = {
      ...thoughtLevels,
      currentId: currentSplit.effort,
    };
  }

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
    thoughtLevels,
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
