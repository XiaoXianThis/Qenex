import type {
  AgentAuthMethod,
  AgentCompat,
  AgentPhase,
  NormalizedAgentError,
} from "./types.ts";
import {
  errorText,
  extractAuthMethods,
  inspectAgentError,
  mergeAuthMethods,
} from "./types.ts";

export function agentErrorDetails(
  error: unknown,
  agentId: string,
  methods?: unknown,
): Record<string, unknown> {
  return {
    cause: errorText(error),
    agentId,
    agentName: agentId,
    methods: mergeAuthMethods(
      extractAuthMethods(error),
      builtinAuthMethods(agentId),
      methods,
    ),
  };
}

export function builtinAuthMethods(agentId: string): AgentAuthMethod[] {
  if (agentId === "gemini") {
    return [
      {
        id: "gemini-login",
        type: "terminal",
        name: "Gemini CLI login",
        externalHint: "gemini",
      },
    ];
  }
  return [];
}

export function classifyGenericAgentError(
  error: unknown,
  phase: AgentPhase,
  agentId: string,
  methods?: unknown,
): NormalizedAgentError | null {
  const kind = inspectAgentError(error);
  const details = agentErrorDetails(error, agentId, methods);
  if (kind === "auth") {
    return {
      code: "auth_required",
      message:
        phase === "chat"
          ? `${agentId} requires authentication`
          : `${agentId} requires authentication. Complete login for this agent, then retry.`,
      status: 409,
      details,
    };
  }
  if (kind === "spawn") {
    return {
      code: "agent_spawn_failed",
      message: `Failed to start the ${agentId} ACP process. Check the install / PATH and retry.`,
      status: 502,
      details,
    };
  }
  if (kind === "balance") {
    return {
      code: "quota_exceeded",
      message: errorText(error) || "Insufficient balance",
      status: 402,
      details,
    };
  }
  if (kind === "model") {
    return {
      code: "model_unavailable",
      message: errorText(error) || "Model is not available",
      status: 409,
      details,
    };
  }
  return null;
}

export const genericAcpCompat: AgentCompat = {
  id: "generic-acp",
  configDiscovery: "advertised",
  resume: "native-load",
  classifyError(error, phase) {
    return classifyGenericAgentError(error, phase, genericAcpCompat.id);
  },
};

export type { AgentAuthMethod };
