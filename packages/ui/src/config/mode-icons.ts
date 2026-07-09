import type { LucideIcon } from "lucide-react";
import {
  BotIcon,
  EyeIcon,
  HammerIcon,
  MapIcon,
  MessageCircleIcon,
  PencilIcon,
  PlayIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ZapIcon,
} from "lucide-react";

/**
 * Mode icon aliases collected from ACP agents listed at:
 * https://agentclientprotocol.com/get-started/agents
 *
 * Covered (where documented):
 * - ACP examples: ask / architect / code
 * - Claude Agent: default, manual, acceptEdits, plan, auto, dontAsk, bypassPermissions
 * - Codex: read-only, auto, full-access
 * - Cursor: agent, plan, ask
 * - Gemini CLI: default, auto-edit / AUTO_EDIT, YOLO, plan
 * - OpenCode: build, plan (+ custom agents)
 * - Cline: plan, act
 * - Kiro: kiro_default, kiro_planner / plan
 * - Qwen Code: plan, default / ask permissions, auto-edit, auto, YOLO
 * - Mistral Vibe: default, plan, accept-edits, auto-approve, lean
 *
 * Match is case-insensitive against mode.id first, then mode.name.
 */
const MODE_ICON_GROUPS: Array<{
  icon: LucideIcon;
  aliases: string[];
}> = [
  // Ask / Q&A / deny-by-default
  {
    icon: MessageCircleIcon,
    aliases: [
      "ask",
      "ask permissions",
      "askpermissions",
      "chat",
      "question",
      "qa",
      "dontask",
      "dont ask",
      "don't ask",
    ],
  },
  // Plan / architect / research
  {
    icon: MapIcon,
    aliases: [
      "plan",
      "planning",
      "planner",
      "architect",
      "kiro planner",
      "kiro_planner",
      "planning agent",
    ],
  },
  // Act / execute (Cline)
  {
    icon: PlayIcon,
    aliases: ["act", "execute", "execution", "implement", "implementation"],
  },
  // Build / code / edit / accept-edits
  {
    icon: PencilIcon,
    aliases: [
      "agent",
      "build",
      "code",
      "coding",
      "edit",
      "write",
      "acceptedits",
      "accept edits",
      "accept-edits",
      "auto edit",
      "autoedit",
      "auto-edit",
      "auto-accept edits",
      "auto accept edits",
    ],
  },
  // Read-only / explore / default-manual
  {
    icon: EyeIcon,
    aliases: [
      "default",
      "manual",
      "read",
      "readonly",
      "read only",
      "read-only",
      "explore",
      "view",
    ],
  },
  // Search / lean / docs
  {
    icon: SearchIcon,
    aliases: ["search", "research", "lean", "docs", "documentation"],
  },
  // Auto / YOLO / auto-approve
  {
    icon: ZapIcon,
    aliases: [
      "auto",
      "automatic",
      "autoapprove",
      "auto approve",
      "auto-approve",
      "yolo",
      "workspace",
    ],
  },
  // Full access / bypass / danger
  {
    icon: ShieldAlertIcon,
    aliases: [
      "bypass",
      "bypasspermissions",
      "bypass permissions",
      "full access",
      "full-access",
      "fullaccess",
      "danger",
      "dangerously",
      "unrestricted",
    ],
  },
  // Guarded / secure
  {
    icon: ShieldCheckIcon,
    aliases: ["safe", "secure", "guarded", "trusted", "trust", "locked"],
  },
  // Debug / fix / tools
  {
    icon: HammerIcon,
    aliases: ["debug", "fix", "tool", "tools", "repair"],
  },
  // Generic bot / assistant / named agents (exact-ish fallbacks)
  {
    icon: BotIcon,
    aliases: [
      "bot",
      "assistant",
      "copilot",
      "kiro",
      "kiro default",
      "kiro_default",
      "vibe",
      "droid",
      "minion",
      "hermes",
      "goose",
      "junie",
      "factory",
      "openclaw",
      "opencode",
      "openhands",
      "qoder",
      "qwen",
      "kimi",
      "cursor",
      "cline",
      "gemini",
      "codex",
      "claude",
    ],
  },
];

const DEFAULT_MODE_ICON: LucideIcon = MessageCircleIcon;

/** Short aliases only match exactly (avoid "pi" matching "api"). */
const CONTAINMENT_MIN_ALIAS_LEN = 4;

function normalizeModeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function compactModeKey(value: string): string {
  return normalizeModeKey(value).replace(/\s+/g, "");
}

function matchAlias(candidate: string, alias: string): boolean {
  const c = normalizeModeKey(candidate);
  const a = normalizeModeKey(alias);
  if (!c || !a) return false;

  const cc = compactModeKey(c);
  const ac = compactModeKey(a);
  if (c === a || cc === ac) return true;

  // Containment only for longer aliases ("accept edits", "full access", …).
  if (ac.length < CONTAINMENT_MIN_ALIAS_LEN) return false;
  return c.includes(a) || cc.includes(ac);
}

export function resolveModeIcon(
  mode: { id: string; name: string },
): LucideIcon {
  for (const group of MODE_ICON_GROUPS) {
    for (const alias of group.aliases) {
      if (matchAlias(mode.id, alias) || matchAlias(mode.name, alias)) {
        return group.icon;
      }
    }
  }
  return DEFAULT_MODE_ICON;
}
