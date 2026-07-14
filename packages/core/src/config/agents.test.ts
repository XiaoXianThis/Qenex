import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_PRESETS,
  DEFAULT_AGENTS_CONFIG,
  isCursorAgentId,
  mergeAgentsConfig,
  migrateToPersistedDocument,
  parseOverlayJson,
  scrubLegacyBunxCommands,
  type AgentPreset,
} from "./agents.ts";

const opencode = DEFAULT_AGENT_PRESETS[0]!;

const claudeDetected: AgentPreset = {
  id: "claude-acp",
  name: "Claude ACP",
  command: [],
  source: "detected",
  registryId: "claude-acp",
};

const systemWithClaude: AgentPreset[] = [opencode, claudeDetected];

describe("mergeAgentsConfig", () => {
  test("off: returns system only and ignores overlay", () => {
    const result = mergeAgentsConfig(
      systemWithClaude,
      "off",
      [{ id: "claude-acp", hidden: true }, { id: "custom", name: "Custom", command: ["x"] }],
      "claude-acp",
    );
    expect(result.agents.map((a) => a.id)).toEqual(["opencode", "claude-acp"]);
    expect(result.defaultAgentId).toBe("claude-acp");
  });

  test("off: injects OpenCode if missing from system", () => {
    const result = mergeAgentsConfig(
      [claudeDetected],
      "off",
      [],
    );
    expect(result.agents[0]?.id).toBe(DEFAULT_AGENT_ID);
    expect(result.agents.map((a) => a.id)).toContain("claude-acp");
  });

  test("extend: can hide, patch command, and add custom agents", () => {
    const result = mergeAgentsConfig(
      systemWithClaude,
      "extend",
      [
        { id: "claude-acp", hidden: true },
        { id: "opencode", command: ["opencode", "acp", "--debug"] },
        {
          id: "my-bot",
          name: "My Bot",
          command: ["my-bot", "acp"],
          registryId: "my-bot",
        },
      ],
      "opencode",
    );
    expect(result.agents.map((a) => a.id).sort()).toEqual([
      "my-bot",
      "opencode",
    ]);
    expect(result.agents.find((a) => a.id === "opencode")?.command).toEqual([
      "opencode",
      "acp",
      "--debug",
    ]);
    expect(result.agents.find((a) => a.id === "my-bot")?.source).toBe("custom");
  });

  test("extend: hiding everything falls back to OpenCode default", () => {
    const result = mergeAgentsConfig(
      systemWithClaude,
      "extend",
      [
        { id: "opencode", hidden: true },
        { id: "claude-acp", hidden: true },
      ],
    );
    expect(result.agents.map((a) => a.id)).toEqual(["opencode"]);
    expect(result.defaultAgentId).toBe(DEFAULT_AGENT_ID);
  });

  test("replace: uses overlay as sole list", () => {
    const result = mergeAgentsConfig(
      systemWithClaude,
      "replace",
      [
        {
          id: "only",
          name: "Only",
          command: ["only"],
        },
      ],
    );
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.id).toBe("only");
    expect(result.agents[0]?.source).toBe("custom");
    expect(result.defaultAgentId).toBe("only");
  });

  test("replace: empty overlay falls back to factory default", () => {
    const result = mergeAgentsConfig(systemWithClaude, "replace", []);
    expect(result.agents.map((a) => a.id)).toEqual(
      DEFAULT_AGENTS_CONFIG.agents.map((a) => a.id),
    );
  });

  test("replace: skips entries without name", () => {
    const result = mergeAgentsConfig(
      systemWithClaude,
      "replace",
      [
        { id: "no-name", command: ["x"] },
        { id: "ok", name: "OK", command: ["ok"] },
      ],
    );
    expect(result.agents.map((a) => a.id)).toEqual(["ok"]);
  });
});

describe("migrateToPersistedDocument", () => {
  test("v1 flat with legacy builtins → mode off, only OpenCode kept", () => {
    const migrated = migrateToPersistedDocument({
      version: 1,
      defaultAgentId: "claude",
      agents: [
        { id: "opencode", name: "OpenCode", command: ["opencode", "acp"], source: "builtin" },
        { id: "claude", name: "Claude", command: ["claude"], source: "builtin" },
        { id: "codex", name: "Codex", command: ["codex"], source: "builtin" },
        { id: "kiro", name: "Kiro", command: ["kiro"], source: "builtin" },
      ],
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.document.mode).toBe("off");
    expect(migrated.document.overlay).toEqual([]);
    expect(migrated.document.systemAgents.map((a) => a.id)).toEqual(["opencode"]);
    expect(migrated.document.defaultAgentId).toBe(DEFAULT_AGENT_ID);
  });

  test("v1 keeps registry/detected/custom agents", () => {
    const migrated = migrateToPersistedDocument({
      version: 1,
      defaultAgentId: "claude-acp",
      agents: [
        { id: "opencode", name: "OpenCode", command: ["opencode", "acp"], source: "builtin" },
        {
          id: "claude-acp",
          name: "Claude",
          command: [],
          source: "registry",
          registryId: "claude-acp",
        },
        {
          id: "cursor-agent",
          name: "Cursor",
          command: [],
          source: "detected",
          registryId: "cursor-agent",
        },
      ],
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.document.systemAgents.map((a) => a.id).sort()).toEqual([
      "claude-acp",
      "cursor-agent",
      "opencode",
    ]);
    expect(migrated.document.defaultAgentId).toBe("claude-acp");
  });

  test("v2 document validates and passes through", () => {
    const migrated = migrateToPersistedDocument({
      version: 2,
      mode: "extend",
      defaultAgentId: "opencode",
      systemAgents: [
        { id: "opencode", name: "OpenCode", command: ["opencode", "acp"] },
      ],
      overlay: [{ id: "opencode", name: "OC" }],
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.document.mode).toBe("extend");
    expect(migrated.document.overlay[0]?.name).toBe("OC");
  });

  test("scrubs legacy bunx/npx on adapter presets during v1 migrate", () => {
    const migrated = migrateToPersistedDocument({
      version: 1,
      defaultAgentId: "claude-acp",
      agents: [
        { id: "opencode", name: "OpenCode", command: ["opencode", "acp"] },
        {
          id: "claude-acp",
          name: "Claude",
          command: ["bunx", "@zed-industries/claude-agent-acp"],
          source: "registry",
          registryId: "claude-acp",
        },
      ],
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const claude = migrated.document.systemAgents.find(
      (a) => a.id === "claude-acp",
    );
    expect(claude?.command).toEqual([]);
  });
});

describe("parseOverlayJson", () => {
  test("accepts v2 extend overlay", () => {
    const parsed = parseOverlayJson(
      JSON.stringify({
        version: 2,
        mode: "extend",
        agents: [{ id: "opencode", hidden: true }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.mode).toBe("extend");
    expect(parsed.document.agents[0]?.hidden).toBe(true);
  });

  test("accepts v1 document as replace seed", () => {
    const parsed = parseOverlayJson(
      JSON.stringify({
        version: 1,
        defaultAgentId: "x",
        agents: [{ id: "x", name: "X", command: ["x"] }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.mode).toBe("replace");
    expect(parsed.document.agents[0]?.id).toBe("x");
  });

  test("rejects invalid JSON", () => {
    const parsed = parseOverlayJson("{");
    expect(parsed.ok).toBe(false);
  });
});

describe("scrubLegacyBunxCommands", () => {
  test("clears bunx/npx for known adapters only", () => {
    const scrubbed = scrubLegacyBunxCommands({
      version: 1,
      defaultAgentId: "opencode",
      agents: [
        {
          id: "claude-acp",
          name: "Claude",
          command: ["npx", "claude-acp"],
          registryId: "claude-acp",
        },
        {
          id: "other",
          name: "Other",
          command: ["npx", "other"],
        },
      ],
    });
    expect(scrubbed.agents[0]?.command).toEqual([]);
    expect(scrubbed.agents[1]?.command).toEqual(["npx", "other"]);
  });
});

describe("factory default", () => {
  test("only OpenCode is builtin", () => {
    expect(DEFAULT_AGENT_PRESETS).toHaveLength(1);
    expect(DEFAULT_AGENT_PRESETS[0]?.id).toBe("opencode");
    expect(DEFAULT_AGENTS_CONFIG.agents).toHaveLength(1);
  });
});

describe("isCursorAgentId", () => {
  test("matches cursor aliases only", () => {
    expect(isCursorAgentId("cursor")).toBe(true);
    expect(isCursorAgentId("cursor-agent")).toBe(true);
    expect(isCursorAgentId("Cursor-Agent")).toBe(true);
    expect(isCursorAgentId("opencode")).toBe(false);
    expect(isCursorAgentId("claude-acp")).toBe(false);
    expect(isCursorAgentId(null)).toBe(false);
  });
});
