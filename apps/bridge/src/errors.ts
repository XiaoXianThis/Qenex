/**
 * Resolve OpenCode binary for ACP.
 * Prefer ~/.bun/bin/opencode over accidental node_modules shims.
 */
import { existsSync } from "node:fs";

export function resolveOpenCodeBin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = env.QENEX_OPENCODE_BIN?.trim();
  if (override) {
    // Bare command name (resolved by OS at spawn time)
    if (!override.includes("/") && !override.includes("\\")) {
      return Bun.which(override) ?? override;
    }
    return existsSync(override) ? override : null;
  }

  const home = env.HOME ?? "";
  const bunBin = home ? `${home}/.bun/bin/opencode` : "";
  if (bunBin && existsSync(bunBin)) return bunBin;

  return Bun.which("opencode") ?? null;
}

export function assertOpenCodeAvailable(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const bin = resolveOpenCodeBin(env);
  if (!bin) {
    throw new BridgeError(
      "opencode_not_found",
      "OpenCode binary not found on PATH. Install OpenCode and ensure `opencode` is available (try `opencode --version`).",
      503,
    );
  }
  if ((bin.includes("/") || bin.includes("\\")) && !existsSync(bin)) {
    throw new BridgeError(
      "opencode_not_found",
      `OpenCode binary not found at ${bin}`,
      503,
    );
  }
  return bin;
}

export class BridgeError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function jsonError(err: unknown): Response {
  if (err instanceof BridgeError) {
    return Response.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? undefined,
        },
      },
      { status: err.status },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return Response.json(
    { error: { code: "internal_error", message } },
    { status: 500 },
  );
}
