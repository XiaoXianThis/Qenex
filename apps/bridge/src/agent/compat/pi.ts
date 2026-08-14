import type { NormalizedAcpSessionConfig } from "../../acp-session-config.ts";
import {
  MODE_THOUGHT_CONFIG_ID,
  effortDisplayName,
  isThinkingModeOption,
  thinkingEffortFromMode,
} from "../../acp-session-config.ts";
import { classifyGenericAgentError } from "./generic-acp.ts";
import type { AgentCompat } from "./types.ts";

const THINKING_NAME_RE = /^thinking\s*:/i;

function isNamedThinkingMode(id: string, name?: string): boolean {
  return THINKING_NAME_RE.test(id) || THINKING_NAME_RE.test(name ?? "");
}

/**
 * pi ACP advertises thinking intensity as session modes. Lift those into
 * thoughtLevels so the UI thought picker is used; keep any real modes.
 */
export function normalizePiCatalog(
  cfg: NormalizedAcpSessionConfig,
): NormalizedAcpSessionConfig {
  const available = cfg.modes?.availableModes ?? [];
  if (available.length === 0) return cfg;

  const namedThinking = available.filter((mode) =>
    isNamedThinkingMode(mode.id, mode.name),
  );
  const allBareThinking =
    namedThinking.length === 0 &&
    available.every((mode) => isThinkingModeOption(mode.id, mode.name));
  const thinking = namedThinking.length > 0 ? namedThinking : allBareThinking ? available : [];
  if (thinking.length === 0) return cfg;

  const thinkingIds = new Set(thinking.map((mode) => mode.id));
  const rest = available.filter((mode) => !thinkingIds.has(mode.id));
  const currentId = cfg.modes?.currentModeId;
  const currentIsThinking = currentId != null && thinkingIds.has(currentId);

  const thoughtFromModes = {
    configId: cfg.thoughtLevels?.configId ?? MODE_THOUGHT_CONFIG_ID,
    currentId: currentIsThinking
      ? currentId
      : (cfg.thoughtLevels?.currentId ?? thinking[0]?.id),
    available: thinking.map((mode) => {
      const effort = thinkingEffortFromMode(mode.id, mode.name);
      return {
        id: mode.id,
        name: effortDisplayName(effort, mode.name),
        ...(mode.description ? { description: mode.description } : {}),
      };
    }),
  };

  const modes =
    rest.length > 0
      ? {
          currentModeId:
            currentId && !currentIsThinking ? currentId : rest[0]?.id,
          availableModes: rest,
        }
      : undefined;

  return {
    ...cfg,
    modes,
    thoughtLevels: cfg.thoughtLevels ?? thoughtFromModes,
  };
}

export const piCompat: AgentCompat = {
  id: "pi-acp",
  configDiscovery: "advertised",
  resume: "native-load",
  normalizeCatalog: normalizePiCatalog,
  classifyError: (error, phase) =>
    classifyGenericAgentError(error, phase, "pi-acp"),
};
