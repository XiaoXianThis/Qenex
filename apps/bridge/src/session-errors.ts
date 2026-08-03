import { BridgeError } from "./errors.ts";

/**
 * Classify ACP init/spawn failures into actionable error codes.
 * Keeps the same JSON error envelope — no new protocol.
 */
export function classifySessionInitError(
  err: unknown,
  agentId = "opencode",
): BridgeError {
  if (err instanceof BridgeError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const details = { cause: message, agentId };

  if (
    /auth|login|unauthori[sz]ed|not authenticated|authentication|token expired|please\s+run\s+.*login|opencode\s+auth|cursor.?login|agent login/i.test(
      lower,
    )
  ) {
    const code =
      agentId === "opencode" ? "opencode_auth_required" : "auth_required";
    return new BridgeError(
      code,
      agentId === "opencode"
        ? "OpenCode requires authentication. Run `opencode auth login` (or your provider login), then retry."
        : `${agentId} requires authentication. Complete login for this agent, then retry.`,
      agentId === "opencode" ? 401 : 409,
      {
        ...details,
        methods: [],
        agentName: agentId,
      },
    );
  }

  if (
    /spawn|enoent|eacces|eperm|failed to start|cannot find|exited with code|signal\s|broken pipe|process\s+.*exited/i.test(
      lower,
    )
  ) {
    const code =
      agentId === "opencode" ? "opencode_spawn_failed" : "agent_spawn_failed";
    return new BridgeError(
      code,
      `Failed to start the ${agentId} ACP process. Check the install / PATH and retry.`,
      502,
      details,
    );
  }

  return new BridgeError(
    "session_init_failed",
    message || `${agentId} ACP session initialization failed`,
    502,
    details,
  );
}
