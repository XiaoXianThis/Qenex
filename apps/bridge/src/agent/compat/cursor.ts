import { classifyGenericAgentError } from "./generic-acp.ts";
import type { AgentCompat, AgentPhase, NormalizedAgentError } from "./types.ts";
import {
  errorText,
  extractAuthMethods,
  inspectAgentError,
  mergeAuthMethods,
} from "./types.ts";

const CURSOR_LOGIN_METHOD = {
  id: "cursor_login",
  type: "cursor_login",
  name: "Cursor Login",
  description: "Sign in with your Cursor account in the browser.",
};

function withCursorLoginMethods(
  classified: NormalizedAgentError,
  error: unknown,
): NormalizedAgentError {
  const methods = mergeAuthMethods(
    extractAuthMethods(error),
    classified.details?.methods,
    [CURSOR_LOGIN_METHOD],
  );
  return {
    ...classified,
    details: {
      ...classified.details,
      cause: errorText(error),
      agentId: "cursor-agent",
      agentName: "cursor-agent",
      methods,
    },
  };
}

function cursorAuthError(
  error: unknown,
  phase: AgentPhase,
): NormalizedAgentError {
  return {
    code: "auth_required",
    message:
      phase === "chat"
        ? "cursor-agent requires authentication"
        : "cursor-agent requires authentication. Sign in with your Cursor account, then retry.",
    status: 409,
    details: {
      cause: errorText(error),
      agentId: "cursor-agent",
      agentName: "cursor-agent",
      methods: [CURSOR_LOGIN_METHOD],
    },
  };
}

function shouldTreatCursorAsAuth(error: unknown, phase: AgentPhase): boolean {
  if (inspectAgentError(error) === "auth") return true;
  if (phase !== "launch" && phase !== "session-init") return false;
  const text = errorText(error).toLowerCase();
  if (
    text.includes("no previous sessions found") ||
    text.includes("session not found") ||
    text.includes("unknown session")
  ) {
    return false;
  }
  if (/\binternal error\b/.test(text)) return true;
  return /not logged in|please (run )?agent login|missing login|no login/.test(
    text,
  );
}

export const cursorCompat: AgentCompat = {
  id: "cursor-agent",
  configDiscovery: "per-model-probe-fallback",
  resume: "reconnect-fresh",
  loginArgv: ["login"],
  classifyError(error, phase) {
    const kind = inspectAgentError(error);
    if (kind && kind !== "auth") {
      return classifyGenericAgentError(error, phase, "cursor-agent");
    }
    const generic = classifyGenericAgentError(error, phase, "cursor-agent");
    if (generic?.code === "auth_required") {
      return withCursorLoginMethods(generic, error);
    }
    if (shouldTreatCursorAsAuth(error, phase)) {
      return withCursorLoginMethods(cursorAuthError(error, phase), error);
    }
    return generic;
  },
};
