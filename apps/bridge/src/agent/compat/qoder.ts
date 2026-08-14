import { classifyGenericAgentError } from "./generic-acp.ts";
import type { AgentCompat, AgentPhase, NormalizedAgentError } from "./types.ts";

const QODER_LOGIN_METHODS = [
  {
    id: "qodercli-login",
    type: "terminal",
    name: "Qoder CLI login",
    externalHint: "qodercli-login",
  },
];

export const qoderCompat: AgentCompat = {
  id: "qoder",
  configDiscovery: "advertised",
  resume: "reconnect-fresh",
  classifyError(
    error: unknown,
    phase: AgentPhase,
  ): NormalizedAgentError | null {
    return classifyGenericAgentError(
      error,
      phase,
      "qoder",
      QODER_LOGIN_METHODS,
    );
  },
};
