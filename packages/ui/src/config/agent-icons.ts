/** Bundled ACP Registry icons (primary), remote CDN fallback, then default. */
/** Source: https://cdn.agentclientprotocol.com/registry/v1/latest/ */

import agoragenticAcpIcon from "@/assets/agent-icons/registry/agoragentic-acp.svg?url";
import ampAcpIcon from "@/assets/agent-icons/registry/amp-acp.svg?url";
import auggieIcon from "@/assets/agent-icons/registry/auggie.svg?url";
import autohandIcon from "@/assets/agent-icons/registry/autohand.svg?url";
import claudeAcpIcon from "@/assets/agent-icons/registry/claude-acp.svg?url";
import clineIcon from "@/assets/agent-icons/registry/cline.svg?url";
import codebuddyCodeIcon from "@/assets/agent-icons/registry/codebuddy-code.svg?url";
import codexAcpIcon from "@/assets/agent-icons/registry/codex-acp.svg?url";
import cortexCodeIcon from "@/assets/agent-icons/registry/cortex-code.svg?url";
import corustAgentIcon from "@/assets/agent-icons/registry/corust-agent.svg?url";
import crowCliIcon from "@/assets/agent-icons/registry/crow-cli.svg?url";
import cursorIcon from "@/assets/agent-icons/registry/cursor.svg?url";
import deepagentsIcon from "@/assets/agent-icons/registry/deepagents.svg?url";
import devinIcon from "@/assets/agent-icons/registry/devin.svg?url";
import dimcodeIcon from "@/assets/agent-icons/registry/dimcode.svg?url";
import diracIcon from "@/assets/agent-icons/registry/dirac.svg?url";
import factoryDroidIcon from "@/assets/agent-icons/registry/factory-droid.svg?url";
import fastAgentIcon from "@/assets/agent-icons/registry/fast-agent.svg?url";
import geminiIcon from "@/assets/agent-icons/registry/gemini.svg?url";
import githubCopilotCliIcon from "@/assets/agent-icons/registry/github-copilot-cli.svg?url";
import glmAcpAgentIcon from "@/assets/agent-icons/registry/glm-acp-agent.svg?url";
import gooseIcon from "@/assets/agent-icons/registry/goose.svg?url";
import grokBuildIcon from "@/assets/agent-icons/registry/grok-build.svg?url";
import harnIcon from "@/assets/agent-icons/registry/harn.svg?url";
import junieIcon from "@/assets/agent-icons/registry/junie.svg?url";
import kiloIcon from "@/assets/agent-icons/registry/kilo.svg?url";
import kimiIcon from "@/assets/agent-icons/registry/kimi.svg?url";
import minionCodeIcon from "@/assets/agent-icons/registry/minion-code.svg?url";
import mistralVibeIcon from "@/assets/agent-icons/registry/mistral-vibe.svg?url";
import novaIcon from "@/assets/agent-icons/registry/nova.svg?url";
import opencodeIcon from "@/assets/agent-icons/registry/opencode.svg?url";
import piAcpIcon from "@/assets/agent-icons/registry/pi-acp.svg?url";
import poolsideIcon from "@/assets/agent-icons/registry/poolside.svg?url";
import qoderIcon from "@/assets/agent-icons/registry/qoder.svg?url";
import qwenCodeIcon from "@/assets/agent-icons/registry/qwen-code.svg?url";
import sigitIcon from "@/assets/agent-icons/registry/sigit.svg?url";
import stakpakIcon from "@/assets/agent-icons/registry/stakpak.svg?url";
import vtcodeIcon from "@/assets/agent-icons/registry/vtcode.svg?url";
import kiroIcon from "@/assets/agent-icons/kiro.svg?url";
import aiderIcon from "@/assets/agent-icons/aider.png?url";
import amrIcon from "@/assets/agent-icons/amr.svg?url";
import antigravityIcon from "@/assets/agent-icons/antigravity.svg?url";
import deepseekIcon from "@/assets/agent-icons/deepseek.svg?url";
import hermesIcon from "@/assets/agent-icons/hermes.svg?url";
import mimoIcon from "@/assets/agent-icons/mimo.svg?url";
import reasonixIcon from "@/assets/agent-icons/reasonix.svg?url";
import traeCliIcon from "@/assets/agent-icons/trae-cli.png?url";
import vibeIcon from "@/assets/agent-icons/vibe.svg?url";
import defaultAgentIcon from "@/assets/agent-icons/default.svg?url";

export const DEFAULT_AGENT_ICON = defaultAgentIcon;

/** Bundled icons keyed by registry / local id */
export const AGENT_ICONS: Record<string, string> = {
  "agoragentic-acp": agoragenticAcpIcon,
  "amp-acp": ampAcpIcon,
  auggie: auggieIcon,
  autohand: autohandIcon,
  "claude-acp": claudeAcpIcon,
  cline: clineIcon,
  "codebuddy-code": codebuddyCodeIcon,
  "codex-acp": codexAcpIcon,
  "cortex-code": cortexCodeIcon,
  "corust-agent": corustAgentIcon,
  "crow-cli": crowCliIcon,
  cursor: cursorIcon,
  deepagents: deepagentsIcon,
  devin: devinIcon,
  dimcode: dimcodeIcon,
  dirac: diracIcon,
  "factory-droid": factoryDroidIcon,
  "fast-agent": fastAgentIcon,
  gemini: geminiIcon,
  "github-copilot-cli": githubCopilotCliIcon,
  "glm-acp-agent": glmAcpAgentIcon,
  goose: gooseIcon,
  "grok-build": grokBuildIcon,
  harn: harnIcon,
  junie: junieIcon,
  kilo: kiloIcon,
  kimi: kimiIcon,
  "minion-code": minionCodeIcon,
  "mistral-vibe": mistralVibeIcon,
  nova: novaIcon,
  opencode: opencodeIcon,
  "pi-acp": piAcpIcon,
  poolside: poolsideIcon,
  qoder: qoderIcon,
  "qwen-code": qwenCodeIcon,
  sigit: sigitIcon,
  stakpak: stakpakIcon,
  vtcode: vtcodeIcon,
  // Local extras (not in current Registry snapshot)
  kiro: kiroIcon,
  aider: aiderIcon,
  amr: amrIcon,
  antigravity: antigravityIcon,
  deepseek: deepseekIcon,
  hermes: hermesIcon,
  mimo: mimoIcon,
  reasonix: reasonixIcon,
  "trae-cli": traeCliIcon,
  vibe: vibeIcon,
};

/** Builtin / legacy id → registry icon id */
const AGENT_ICON_ALIASES: Record<string, string> = {
  claude: "claude-acp",
  codex: "codex-acp",
  "cursor-agent": "cursor",
  copilot: "github-copilot-cli",
  pi: "pi-acp",
  qwen: "qwen-code",
  vibe: "mistral-vibe",
};

const REGISTRY_ICON_CDN =
  "https://cdn.agentclientprotocol.com/registry/v1/latest";

function resolveLocalIcon(agentId: string): string | undefined {
  const id = agentId.trim();
  if (!id) return undefined;
  const aliased = AGENT_ICON_ALIASES[id] ?? id;
  if (AGENT_ICONS[aliased]) return AGENT_ICONS[aliased];
  if (AGENT_ICONS[id]) return AGENT_ICONS[id];
  const base = id.replace(/-acp$/, "");
  if (AGENT_ICONS[base]) return AGENT_ICONS[base];
  const withAcp = `${base}-acp`;
  if (AGENT_ICONS[withAcp]) return AGENT_ICONS[withAcp];
  return undefined;
}

/** Official Registry CDN URL for an agent id (may 404 for unknown ids). */
export function registryCdnIconUrl(agentId: string): string | undefined {
  const id = (AGENT_ICON_ALIASES[agentId] ?? agentId).trim();
  if (!id) return undefined;
  return `${REGISTRY_ICON_CDN}/${encodeURIComponent(id)}.svg`;
}

/**
 * Resolve agent icon URL.
 * Priority: bundled local → explicit remote → Registry CDN → default.
 */
export function getAgentPresetIconUrl(
  agentId: string,
  remoteIcon?: string | null,
): string {
  const local = resolveLocalIcon(agentId);
  if (local) return local;
  if (remoteIcon && /^https?:\/\//i.test(remoteIcon)) {
    return remoteIcon;
  }
  return registryCdnIconUrl(agentId) ?? DEFAULT_AGENT_ICON;
}

/**
 * Candidate URLs in fallback order for runtime onError chaining.
 * Always ends with DEFAULT_AGENT_ICON.
 */
export function getAgentIconCandidates(
  agentId: string,
  remoteIcon?: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url: string | undefined | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  push(resolveLocalIcon(agentId));
  if (remoteIcon && /^https?:\/\//i.test(remoteIcon)) {
    push(remoteIcon);
  }
  push(registryCdnIconUrl(agentId));
  push(DEFAULT_AGENT_ICON);
  return out;
}

export type AgentIconId = string;
