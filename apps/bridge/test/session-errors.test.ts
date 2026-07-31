import { describe, expect, test } from "bun:test";
import { classifySessionInitError } from "../src/session-errors.ts";
import { BridgeError } from "../src/errors.ts";

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

  test("keeps BridgeError and defaults other messages", () => {
    const existing = new BridgeError("session_init_failed", "x", 502);
    expect(classifySessionInitError(existing)).toBe(existing);
    const other = classifySessionInitError(new Error("weird ACP handshake"));
    expect(other.code).toBe("session_init_failed");
    expect(other.message).toContain("weird ACP handshake");
  });
});
