import { describe, expect, test } from "bun:test";
import { authHintFor, canonicalAgentId } from "../src/agent/detect.ts";

describe("canonicalAgentId", () => {
  test("maps host aliases to canonical ACP ids", () => {
    expect(canonicalAgentId("claude")).toBe("claude-acp");
    expect(canonicalAgentId("codex")).toBe("codex-acp");
    expect(canonicalAgentId("cursor")).toBe("cursor-agent");
    expect(canonicalAgentId("pi")).toBe("pi-acp");
    expect(canonicalAgentId("qodercli")).toBe("qoder");
    expect(canonicalAgentId("opencode")).toBe("opencode");
  });
});

describe("authHintFor", () => {
  test("returns a hint string or null for known agents", () => {
    for (const id of [
      "claude-acp",
      "codex-acp",
      "cursor-agent",
      "pi-acp",
      "qoder",
    ]) {
      const hint = authHintFor(id);
      expect(hint === null || typeof hint === "string").toBe(true);
    }
    expect(authHintFor("opencode")).toBeNull();
  });
});
