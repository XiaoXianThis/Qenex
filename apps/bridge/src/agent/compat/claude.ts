import type { NormalizedAcpSessionConfig } from "../../acp-session-config.ts";
import { classifyGenericAgentError } from "./generic-acp.ts";
import type { AgentCompat } from "./types.ts";

const ID_LABELS: Record<string, string> = {
  default: "Default",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

function titleCaseId(modelId: string): string {
  const token = modelId.split("/").pop()?.trim() || modelId;
  const known = ID_LABELS[token.toLowerCase()];
  if (known) return known;
  return token
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function collidingNameSet(
  models: NonNullable<NormalizedAcpSessionConfig["models"]>["availableModels"],
): Set<string> {
  const counts = new Map<string, number>();
  for (const model of models) {
    const name = (model.name ?? "").trim().toLowerCase();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
  );
}

/**
 * Claude ACP may advertise opus/sonnet/haiku while every `name` is the
 * upstream routed model. Prefer description, else a label derived from id.
 */
export function normalizeClaudeCatalog(
  cfg: NormalizedAcpSessionConfig,
): NormalizedAcpSessionConfig {
  const available = cfg.models?.availableModels ?? [];
  if (available.length === 0) return cfg;
  const colliding = collidingNameSet(available);
  const hasEmpty = available.some((model) => !(model.name ?? "").trim());
  if (colliding.size === 0 && !hasEmpty) return cfg;

  return {
    ...cfg,
    models: {
      currentModelId: cfg.models?.currentModelId,
      availableModels: available.map((model) => {
        const current = (model.name ?? "").trim();
        const shouldRewrite =
          !current || colliding.has(current.toLowerCase());
        if (!shouldRewrite) return model;
        const description = model.description?.trim();
        const name = description || titleCaseId(model.modelId);
        return description
          ? { modelId: model.modelId, name, description: model.description }
          : { modelId: model.modelId, name };
      }),
    },
  };
}

export const claudeCompat: AgentCompat = {
  id: "claude-acp",
  configDiscovery: "advertised",
  resume: "native-load",
  normalizeCatalog: normalizeClaudeCatalog,
  classifyError: (error, phase) =>
    classifyGenericAgentError(error, phase, "claude-acp"),
};
