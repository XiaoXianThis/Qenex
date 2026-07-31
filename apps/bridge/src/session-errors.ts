import { BridgeError } from "./errors.ts";

/**
 * Classify OpenCode ACP init/spawn failures into actionable error codes.
 * Keeps the same JSON error envelope — no new protocol.
 */
export function classifySessionInitError(err: unknown): BridgeError {
  if (err instanceof BridgeError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const details = { cause: message };

  if (
    /auth|login|unauthori[sz]ed|not authenticated|authentication|token expired|please\s+run\s+.*login|opencode\s+auth/i.test(
      lower,
    )
  ) {
    return new BridgeError(
      "opencode_auth_required",
      "OpenCode requires authentication. Run `opencode auth login` (or your provider login), then retry.",
      401,
      details,
    );
  }

  if (
    /spawn|enoent|eacces|eperm|failed to start|cannot find|exited with code|signal\s|broken pipe|process\s+.*exited/i.test(
      lower,
    )
  ) {
    return new BridgeError(
      "opencode_spawn_failed",
      "Failed to start the OpenCode ACP process. Check that `opencode` runs in a terminal (`opencode --version`) and retry.",
      502,
      details,
    );
  }

  return new BridgeError(
    "session_init_failed",
    message || "OpenCode ACP session initialization failed",
    502,
    details,
  );
}
