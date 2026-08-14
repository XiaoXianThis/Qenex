import { describe, expect, test } from "bun:test";
import { classifySessionInitError } from "../src/session-errors.ts";
import { BridgeError, jsonError } from "../src/errors.ts";
import { isMissingProviderSessionError } from "../src/session-store.ts";

describe("classifySessionInitError", () => {
  test("maps auth-like failures", () => {
    const err = classifySessionInitError(
      new Error("Unauthorized: please run opencode auth login"),
    );
    expect(err.code).toBe("opencode_auth_required");
    expect(err.status).toBe(401);
  });

  test("maps spawn-like failures", () => {
    const err = classifySessionInitError(
      new Error("spawn ENOENT: failed to start process"),
    );
    expect(err.code).toBe("opencode_spawn_failed");
    expect(err.status).toBe(502);
  });

  test("keeps classified BridgeError and defaults other messages", () => {
    const existing = new BridgeError("agent_spawn_failed", "x", 502);
    expect(classifySessionInitError(existing)).toBe(existing);
    const opaque = classifySessionInitError(
      new BridgeError("session_init_failed", "weird ACP handshake", 502),
    );
    expect(opaque.code).toBe("session_init_failed");
    expect(opaque.message).toContain("weird ACP handshake");
    const other = classifySessionInitError(new Error("weird ACP handshake"));
    expect(other.code).toBe("session_init_failed");
    expect(other.message).toContain("weird ACP handshake");
  });

  test("reclassifies Cursor session_init_failed Internal error as auth", () => {
    const err = classifySessionInitError(
      new BridgeError("session_init_failed", "Internal error", 502),
      "cursor-agent",
    );
    expect(err.code).toBe("auth_required");
    const details = err.details as {
      methods?: Array<{ id: string; externalHint?: string }>;
    };
    expect(details.methods?.some((m) => m.id === "cursor_login")).toBe(true);
  });

  test("flattens JSON-RPC objects instead of [object Object]", () => {
    const err = classifySessionInitError(
      { code: -32602, message: "Invalid params: model not found: x" },
      "claude-acp",
    );
    expect(err.message).toContain("model not found");
    expect(err.message).not.toBe("[object Object]");
    expect(err.code).toBe("model_unavailable");
  });

  test("classifies Cursor Internal error as auth_required with methods", () => {
    const err = classifySessionInitError(
      { code: -32603, message: "Internal error" },
      "cursor-agent",
    );
    expect(err.code).toBe("auth_required");
    const details = err.details as {
      methods?: Array<{ id: string; externalHint?: string }>;
    };
    expect(details.methods?.length).toBeGreaterThan(0);
    expect(details.methods?.some((m) => m.id === "cursor_login")).toBe(true);
  });

  test("merges initialize authMethods into details", () => {
    const err = classifySessionInitError(
      new Error("authentication required"),
      "gemini",
      { authMethods: [{ id: "oauth-personal", name: "Google" }] },
    );
    expect(err.code).toBe("auth_required");
    const details = err.details as { methods?: Array<{ id: string; name: string }> };
    expect(details.methods?.some((m) => m.id === "oauth-personal")).toBe(true);
  });

  test("session_init_timeout with advertised auth methods stays timeout", () => {
    const err = classifySessionInitError(
      new BridgeError(
        "session_init_timeout",
        "Agent did not initialize within 45000ms",
        504,
      ),
      "gemini",
      { authMethods: [{ id: "oauth-personal", name: "Google" }] },
    );
    expect(err.code).toBe("session_init_timeout");
    expect(err.status).toBe(504);
    const details = err.details as { methods?: Array<{ id: string }> };
    expect(details.methods?.some((m) => m.id === "oauth-personal")).toBe(true);
  });

  test("session_init_timeout without auth methods stays timeout", () => {
    const err = classifySessionInitError(
      new BridgeError(
        "session_init_timeout",
        "Agent did not initialize within 45000ms",
        504,
      ),
      "gemini",
    );
    expect(err.code).toBe("session_init_timeout");
    expect(err.status).toBe(504);
  });

  test("session_init_timeout with empty auth methods stays timeout", () => {
    const err = classifySessionInitError(
      new BridgeError(
        "session_init_timeout",
        "Agent did not initialize within 45000ms",
        504,
      ),
      "codex-acp",
      { authMethods: [] },
    );
    expect(err.code).toBe("session_init_timeout");
  });
});

describe("jsonError", () => {
  test("serializes JSON-RPC objects with a string message", async () => {
    const res = jsonError({
      code: -32602,
      message: "Invalid params: model not found: x",
    });
    const body = (await res.json()) as {
      error: { message: string; code: string };
    };
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message).not.toBe("[object Object]");
    expect(body.error.message).toContain("model not found");
  });
});

describe("isMissingProviderSessionError", () => {
  test("recognizes an ACP load failure with nested details", () => {
    const error = Object.assign(new Error("Internal error"), {
      data: { details: "No previous sessions found for this project." },
    });
    expect(isMissingProviderSessionError(error)).toBe(true);
  });

  test("recognizes Codex missing rollout on session/load", () => {
    expect(
      isMissingProviderSessionError(
        new Error("Internal error no rollout found for thread id abc"),
      ),
    ).toBe(true);
  });

  test("does not hide authentication or network failures", () => {
    expect(isMissingProviderSessionError(new Error("Unauthorized"))).toBe(false);
    expect(isMissingProviderSessionError(new Error("connection timed out"))).toBe(
      false,
    );
  });
});
