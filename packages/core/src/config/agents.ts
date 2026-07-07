export type AgentPreset = {
  id: string;
  name: string;
  command: string[];
};

export const AGENT_PRESETS: AgentPreset[] = [
  { id: "opencode", name: "OpenCode", command: ["opencode", "acp"] },
  { id: "kiro", name: "Kiro", command: ["kiro-cli", "acp"] },
  {
    id: "claude",
    name: "Claude",
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
  },
  {
    id: "codex",
    name: "Codex",
    command: ["npx", "-y", "@zed-industries/codex-acp"],
  },
];

export const DEFAULT_AGENT_ID = "opencode";

export function getAgentPreset(id: string): AgentPreset {
  return (
    AGENT_PRESETS.find((agent) => agent.id === id) ??
    AGENT_PRESETS.find((agent) => agent.id === DEFAULT_AGENT_ID)!
  );
}
