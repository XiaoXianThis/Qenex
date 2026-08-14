import { BridgeError } from "./errors.ts";
import { resolveAgentCompat } from "./agent/compat/registry.ts";
import {
  errorText,
  extractAuthMethods,
  mergeAuthMethods,
} from "./agent/compat/types.ts";

export type SessionInitErrorExtras = {
  authMethods?: unknown;
};

/**
 * Classify ACP init/spawn failures into actionable error codes.
 * Keeps the same JSON error envelope — no new protocol.
 *
 * Timeouts stay timeouts even when initialize advertised auth methods.
 * Gemini always lists oauth-personal; treating timeout as login false-positives
 * already-authenticated users.
 */
const OPAQUE_INIT_CODES = new Set(["session_init_failed", "internal_error"]);

export function classifySessionInitError(
  err: unknown,
  agentId = "opencode",
  extras?: SessionInitErrorExtras,
): BridgeError {
  const opaqueBridge =
    err instanceof BridgeError && OPAQUE_INIT_CODES.has(err.code);

  if (err instanceof BridgeError && !opaqueBridge) {
    if (!extras?.authMethods) return err;
    const details =
      err.details && typeof err.details === "object"
        ? { ...(err.details as Record<string, unknown>) }
        : { cause: errorText(err), agentId };
    details.methods = mergeAuthMethods(
      details.methods,
      extras.authMethods,
      extractAuthMethods(err),
    );
    return new BridgeError(err.code, err.message, err.status, details);
  }

  const message = errorText(err);
  const classified = resolveAgentCompat(agentId).classifyError?.(
    err,
    "session-init",
  );
  const methods = mergeAuthMethods(
    classified?.details?.methods,
    extras?.authMethods,
    extractAuthMethods(err),
  );
  if (classified) {
    const details = {
      ...(classified.details ?? { cause: message, agentId }),
      methods,
      agentId: classified.details?.agentId ?? agentId,
    };
    return new BridgeError(
      classified.code,
      classified.message,
      classified.status,
      details,
    );
  }

  return new BridgeError(
    "session_init_failed",
    message || `${agentId} ACP session initialization failed`,
    502,
    { cause: message, agentId, methods },
  );
}
