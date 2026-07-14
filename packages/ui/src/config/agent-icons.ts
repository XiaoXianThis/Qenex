/** Bundled ACP Registry icons (primary), remote CDN fallback, then default. */
/** Source: https://cdn.agentclientprotocol.com/registry/v1/latest/ */

import type { FC, SVGProps } from "react";

import AgoragenticAcpIcon from "@/assets/agent-icons/registry/agoragentic-acp.svg?react";
import AmpAcpIcon from "@/assets/agent-icons/registry/amp-acp.svg?react";
import AuggieIcon from "@/assets/agent-icons/registry/auggie.svg?react";
import AutohandIcon from "@/assets/agent-icons/registry/autohand.svg?react";
import ClaudeAcpIcon from "@/assets/agent-icons/registry/claude-acp.svg?react";
import ClineIcon from "@/assets/agent-icons/registry/cline.svg?react";
import CodebuddyCodeIcon from "@/assets/agent-icons/registry/codebuddy-code.svg?react";
import CodexAcpIcon from "@/assets/agent-icons/registry/codex-acp.svg?react";
import CortexCodeIcon from "@/assets/agent-icons/registry/cortex-code.svg?react";
import CorustAgentIcon from "@/assets/agent-icons/registry/corust-agent.svg?react";
import CrowCliIcon from "@/assets/agent-icons/registry/crow-cli.svg?react";
import CursorIcon from "@/assets/agent-icons/registry/cursor.svg?react";
import DeepagentsIcon from "@/assets/agent-icons/registry/deepagents.svg?react";
import DevinIcon from "@/assets/agent-icons/registry/devin.svg?react";
import DimcodeIcon from "@/assets/agent-icons/registry/dimcode.svg?react";
import DiracIcon from "@/assets/agent-icons/registry/dirac.svg?react";
import FactoryDroidIcon from "@/assets/agent-icons/registry/factory-droid.svg?react";
import FastAgentIcon from "@/assets/agent-icons/registry/fast-agent.svg?react";
import GeminiIcon from "@/assets/agent-icons/registry/gemini.svg?react";
import GithubCopilotCliIcon from "@/assets/agent-icons/registry/github-copilot-cli.svg?react";
import GlmAcpAgentIcon from "@/assets/agent-icons/registry/glm-acp-agent.svg?react";
import GooseIcon from "@/assets/agent-icons/registry/goose.svg?react";
import GrokBuildIcon from "@/assets/agent-icons/registry/grok-build.svg?react";
import HarnIcon from "@/assets/agent-icons/registry/harn.svg?react";
import JunieIcon from "@/assets/agent-icons/registry/junie.svg?react";
import KiloIcon from "@/assets/agent-icons/registry/kilo.svg?react";
import KimiIcon from "@/assets/agent-icons/registry/kimi.svg?react";
import MinionCodeIcon from "@/assets/agent-icons/registry/minion-code.svg?react";
import MistralVibeIcon from "@/assets/agent-icons/registry/mistral-vibe.svg?react";
import NovaIcon from "@/assets/agent-icons/registry/nova.svg?react";
import OpencodeIcon from "@/assets/agent-icons/registry/opencode.svg?react";
import PiAcpIcon from "@/assets/agent-icons/registry/pi-acp.svg?react";
import PoolsideIcon from "@/assets/agent-icons/registry/poolside.svg?react";
import QoderIcon from "@/assets/agent-icons/registry/qoder.svg?react";
import QwenCodeIcon from "@/assets/agent-icons/registry/qwen-code.svg?react";
import SigitIcon from "@/assets/agent-icons/registry/sigit.svg?react";
import StakpakIcon from "@/assets/agent-icons/registry/stakpak.svg?react";
import VtcodeIcon from "@/assets/agent-icons/registry/vtcode.svg?react";
import KiroIcon from "@/assets/agent-icons/kiro.svg?react";
import AmrIcon from "@/assets/agent-icons/amr.svg?react";
import AntigravityIcon from "@/assets/agent-icons/antigravity.svg?react";
import DeepseekIcon from "@/assets/agent-icons/deepseek.svg?react";
import HermesIcon from "@/assets/agent-icons/hermes.svg?react";
import MimoIcon from "@/assets/agent-icons/mimo.svg?react";
import ReasonixIcon from "@/assets/agent-icons/reasonix.svg?react";
import VibeIcon from "@/assets/agent-icons/vibe.svg?react";
import DefaultAgentIcon from "@/assets/agent-icons/default.svg?react";

import aiderIconUrl from "@/assets/agent-icons/aider.png?url";
import traeCliIconUrl from "@/assets/agent-icons/trae-cli.png?url";

export type AgentSvgIcon = FC<SVGProps<SVGSVGElement>>;

export const DEFAULT_AGENT_ICON: AgentSvgIcon = DefaultAgentIcon;

/** Bundled SVG icons as React components (currentColor / text-foreground) */
export const AGENT_ICON_COMPONENTS: Record<string, AgentSvgIcon> = {
  "agoragentic-acp": AgoragenticAcpIcon,
  "amp-acp": AmpAcpIcon,
  auggie: AuggieIcon,
  autohand: AutohandIcon,
  "claude-acp": ClaudeAcpIcon,
  cline: ClineIcon,
  "codebuddy-code": CodebuddyCodeIcon,
  "codex-acp": CodexAcpIcon,
  "cortex-code": CortexCodeIcon,
  "corust-agent": CorustAgentIcon,
  "crow-cli": CrowCliIcon,
  cursor: CursorIcon,
  deepagents: DeepagentsIcon,
  devin: DevinIcon,
  dimcode: DimcodeIcon,
  dirac: DiracIcon,
  "factory-droid": FactoryDroidIcon,
  "fast-agent": FastAgentIcon,
  gemini: GeminiIcon,
  "github-copilot-cli": GithubCopilotCliIcon,
  "glm-acp-agent": GlmAcpAgentIcon,
  goose: GooseIcon,
  "grok-build": GrokBuildIcon,
  harn: HarnIcon,
  junie: JunieIcon,
  kilo: KiloIcon,
  kimi: KimiIcon,
  "minion-code": MinionCodeIcon,
  "mistral-vibe": MistralVibeIcon,
  nova: NovaIcon,
  opencode: OpencodeIcon,
  "pi-acp": PiAcpIcon,
  poolside: PoolsideIcon,
  qoder: QoderIcon,
  "qwen-code": QwenCodeIcon,
  sigit: SigitIcon,
  stakpak: StakpakIcon,
  vtcode: VtcodeIcon,
  kiro: KiroIcon,
  amr: AmrIcon,
  antigravity: AntigravityIcon,
  deepseek: DeepseekIcon,
  hermes: HermesIcon,
  mimo: MimoIcon,
  reasonix: ReasonixIcon,
  vibe: VibeIcon,
};

/** Bundled raster icons (cannot follow currentColor) */
export const AGENT_ICON_IMAGES: Record<string, string> = {
  aider: aiderIconUrl,
  "trae-cli": traeCliIconUrl,
};

/** @deprecated 使用 AGENT_ICON_COMPONENTS；保留别名以免外部误用 */
export const AGENT_ICONS = AGENT_ICON_IMAGES;

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

function resolveIconKey(agentId: string): string | undefined {
  const id = agentId.trim();
  if (!id) return undefined;
  const aliased = AGENT_ICON_ALIASES[id] ?? id;
  const candidates = [aliased, id, id.replace(/-acp$/, ""), `${id.replace(/-acp$/, "")}-acp`];
  for (const key of candidates) {
    if (AGENT_ICON_COMPONENTS[key] || AGENT_ICON_IMAGES[key]) return key;
  }
  return undefined;
}

export function resolveLocalIconComponent(
  agentId: string,
): AgentSvgIcon | undefined {
  const key = resolveIconKey(agentId);
  if (!key) return undefined;
  return AGENT_ICON_COMPONENTS[key];
}

export function resolveLocalIconImageUrl(
  agentId: string,
): string | undefined {
  const key = resolveIconKey(agentId);
  if (!key) return undefined;
  return AGENT_ICON_IMAGES[key];
}

/** Official Registry CDN URL for an agent id (may 404 for unknown ids). */
export function registryCdnIconUrl(agentId: string): string | undefined {
  const id = (AGENT_ICON_ALIASES[agentId] ?? agentId).trim();
  if (!id) return undefined;
  return `${REGISTRY_ICON_CDN}/${encodeURIComponent(id)}.svg`;
}

/**
 * Resolve agent icon URL (raster / remote only).
 * Prefer resolveLocalIconComponent for bundled SVGs.
 */
export function getAgentPresetIconUrl(
  agentId: string,
  remoteIcon?: string | null,
): string {
  const localImage = resolveLocalIconImageUrl(agentId);
  if (localImage) return localImage;
  if (remoteIcon && /^https?:\/\//i.test(remoteIcon)) {
    return remoteIcon;
  }
  return registryCdnIconUrl(agentId) ?? "";
}

/**
 * Remote / raster fallback URLs when no local SVG component exists.
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
  push(resolveLocalIconImageUrl(agentId));
  if (remoteIcon && /^https?:\/\//i.test(remoteIcon)) {
    push(remoteIcon);
  }
  push(registryCdnIconUrl(agentId));
  return out;
}

export type AgentIconId = string;
