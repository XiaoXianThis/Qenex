import aiderIcon from "@/assets/agent-icons/aider.png?url";
import amrIcon from "@/assets/agent-icons/amr.svg?url";
import antigravityIcon from "@/assets/agent-icons/antigravity.svg?url";
import claudeIcon from "@/assets/agent-icons/claude.svg?url";
import codexIcon from "@/assets/agent-icons/codex.svg?url";
import copilotIcon from "@/assets/agent-icons/copilot.svg?url";
import cursorAgentIcon from "@/assets/agent-icons/cursor-agent.svg?url";
import deepseekIcon from "@/assets/agent-icons/deepseek.svg?url";
import devinIcon from "@/assets/agent-icons/devin.png?url";
import geminiIcon from "@/assets/agent-icons/gemini.svg?url";
import grokBuildIcon from "@/assets/agent-icons/grok-build.svg?url";
import hermesIcon from "@/assets/agent-icons/hermes.svg?url";
import kiloIcon from "@/assets/agent-icons/kilo.svg?url";
import kimiIcon from "@/assets/agent-icons/kimi.svg?url";
import kiroIcon from "@/assets/agent-icons/kiro.svg?url";
import mimoIcon from "@/assets/agent-icons/mimo.svg?url";
import opencodeIcon from "@/assets/agent-icons/opencode.svg?url";
import piIcon from "@/assets/agent-icons/pi.svg?url";
import qoderIcon from "@/assets/agent-icons/qoder.svg?url";
import qwenIcon from "@/assets/agent-icons/qwen.svg?url";
import reasonixIcon from "@/assets/agent-icons/reasonix.svg?url";
import traeCliIcon from "@/assets/agent-icons/trae-cli.png?url";
import vibeIcon from "@/assets/agent-icons/vibe.svg?url";

/** Icons from https://github.com/nexu-io/open-design/tree/main/apps/web/public/agent-icons */
export const AGENT_ICONS = {
  aider: aiderIcon,
  amr: amrIcon,
  antigravity: antigravityIcon,
  claude: claudeIcon,
  codex: codexIcon,
  copilot: copilotIcon,
  "cursor-agent": cursorAgentIcon,
  deepseek: deepseekIcon,
  devin: devinIcon,
  gemini: geminiIcon,
  "grok-build": grokBuildIcon,
  hermes: hermesIcon,
  kilo: kiloIcon,
  kimi: kimiIcon,
  kiro: kiroIcon,
  mimo: mimoIcon,
  opencode: opencodeIcon,
  pi: piIcon,
  qoder: qoderIcon,
  qwen: qwenIcon,
  reasonix: reasonixIcon,
  "trae-cli": traeCliIcon,
  vibe: vibeIcon,
} as const;

export type AgentIconId = keyof typeof AGENT_ICONS;

const AGENT_PRESET_ICON: Record<string, string> = {
  opencode: AGENT_ICONS.opencode,
  kiro: AGENT_ICONS.kiro,
  claude: AGENT_ICONS.claude,
  "claude-acp": AGENT_ICONS.claude,
  codex: AGENT_ICONS.codex,
  "codex-acp": AGENT_ICONS.codex,
  gemini: AGENT_ICONS.gemini,
  "cursor-agent": AGENT_ICONS["cursor-agent"],
  copilot: AGENT_ICONS.copilot,
  kilo: AGENT_ICONS.kilo,
  kimi: AGENT_ICONS.kimi,
  qwen: AGENT_ICONS.qwen,
  qoder: AGENT_ICONS.qoder,
  pi: AGENT_ICONS.pi,
  aider: AGENT_ICONS.aider,
  hermes: AGENT_ICONS.hermes,
  vibe: AGENT_ICONS.vibe,
  deepseek: AGENT_ICONS.deepseek,
};

export function getAgentPresetIconUrl(
  agentId: string,
  remoteIcon?: string | null,
): string {
  if (remoteIcon && /^https?:\/\//i.test(remoteIcon)) {
    return remoteIcon;
  }
  if (AGENT_PRESET_ICON[agentId]) {
    return AGENT_PRESET_ICON[agentId];
  }
  // Strip common registry suffixes: foo-acp → foo
  const base = agentId.replace(/-acp$/, "");
  if (AGENT_PRESET_ICON[base]) {
    return AGENT_PRESET_ICON[base];
  }
  if (base in AGENT_ICONS) {
    return AGENT_ICONS[base as AgentIconId];
  }
  return AGENT_ICONS.opencode;
}
