import { canonicalAgentId } from "../detect.ts";
import type { NormalizedAcpSessionConfig } from "../../acp-session-config.ts";
import { claudeCompat } from "./claude.ts";
import { codexCompat } from "./codex.ts";
import { cursorCompat } from "./cursor.ts";
import { classifyGenericAgentError, genericAcpCompat } from "./generic-acp.ts";
import { opencodeCompat } from "./opencode.ts";
import { piCompat } from "./pi.ts";
import { qoderCompat } from "./qoder.ts";
import type { AgentCompat } from "./types.ts";

const BY_ID: Record<string, AgentCompat> = {
  [opencodeCompat.id]: opencodeCompat,
  [cursorCompat.id]: cursorCompat,
  [codexCompat.id]: codexCompat,
  [piCompat.id]: piCompat,
  [claudeCompat.id]: claudeCompat,
  [qoderCompat.id]: qoderCompat,
};

/** Unmatched agents use generic ACP. Aliases are resolved in detect.ts. */
export function resolveAgentCompat(agentId: string): AgentCompat {
  const id = canonicalAgentId(agentId);
  const matched = BY_ID[id];
  if (matched) return matched;
  return {
    ...genericAcpCompat,
    classifyError: (error, phase) => classifyGenericAgentError(error, phase, id),
  };
}

/** Single call site for optional per-agent catalog rewrites. */
export function applyCompatCatalog(
  agentId: string,
  normalized: NormalizedAcpSessionConfig,
): NormalizedAcpSessionConfig {
  return resolveAgentCompat(agentId).normalizeCatalog?.(normalized) ?? normalized;
}

export type { AgentCompat } from "./types.ts";
export type {
  ConfigDiscovery,
  LaunchContext,
  LaunchPatch,
  NormalizedAgentError,
  ResumeBehavior,
} from "./types.ts";
