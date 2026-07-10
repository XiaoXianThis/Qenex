import { beforeEach, describe, expect, test } from "bun:test";
import {
  agentsActions,
  agentsStore,
} from "../store/agents-store.ts";
import { DEFAULT_AGENT_ID } from "./agents.ts";

describe("agentsActions modes", () => {
  beforeEach(() => {
    agentsActions.resetToDefault();
  });

  test("factory default is OpenCode only with mode off", () => {
    expect(agentsStore.mode).toBe("off");
    expect(agentsStore.agents.map((a) => a.id)).toEqual(["opencode"]);
    expect(agentsStore.defaultAgentId).toBe(DEFAULT_AGENT_ID);
  });

  test("mergeDetectedAgents adds ready agents to system layer", () => {
    agentsActions.mergeDetectedAgents([
      { id: "claude-acp", name: "Claude", readiness: "ready" },
      { id: "ghost", name: "Ghost", readiness: "install" },
    ]);
    expect(agentsStore.systemAgents.map((a) => a.id).sort()).toEqual([
      "claude-acp",
      "opencode",
    ]);
    expect(agentsStore.agents.map((a) => a.id).sort()).toEqual([
      "claude-acp",
      "opencode",
    ]);
  });

  test("extend overlay can hide a system agent", () => {
    agentsActions.mergeDetectedAgents([
      { id: "claude-acp", name: "Claude", readiness: "ready" },
    ]);
    agentsActions.setMode("extend");
    agentsActions.setOverlay({
      version: 2,
      mode: "extend",
      agents: [{ id: "claude-acp", hidden: true }],
    });
    expect(agentsStore.mode).toBe("extend");
    expect(agentsStore.agents.map((a) => a.id)).toEqual(["opencode"]);
    expect(agentsStore.systemAgents.map((a) => a.id)).toContain("claude-acp");
  });

  test("replace ignores system agents", () => {
    agentsActions.mergeDetectedAgents([
      { id: "claude-acp", name: "Claude", readiness: "ready" },
    ]);
    agentsActions.setMode("replace");
    agentsActions.setOverlay({
      version: 2,
      mode: "replace",
      defaultAgentId: "solo",
      agents: [{ id: "solo", name: "Solo", command: ["solo"] }],
    });
    expect(agentsStore.agents.map((a) => a.id)).toEqual(["solo"]);
    expect(agentsStore.systemAgents.map((a) => a.id)).toContain("claude-acp");
  });

  test("setMode(off) restores system-only effective list", () => {
    agentsActions.mergeDetectedAgents([
      { id: "claude-acp", name: "Claude", readiness: "ready" },
    ]);
    agentsActions.setMode("extend");
    agentsActions.setOverlay({
      version: 2,
      mode: "extend",
      agents: [{ id: "claude-acp", hidden: true }],
    });
    agentsActions.setMode("off");
    expect(agentsStore.agents.map((a) => a.id).sort()).toEqual([
      "claude-acp",
      "opencode",
    ]);
  });

  test("resetToDefault clears overlay and detections", () => {
    agentsActions.mergeDetectedAgents([
      { id: "claude-acp", name: "Claude", readiness: "ready" },
    ]);
    agentsActions.setMode("extend");
    agentsActions.resetToDefault();
    expect(agentsStore.mode).toBe("off");
    expect(agentsStore.overlay).toEqual([]);
    expect(agentsStore.agents.map((a) => a.id)).toEqual(["opencode"]);
  });
});
