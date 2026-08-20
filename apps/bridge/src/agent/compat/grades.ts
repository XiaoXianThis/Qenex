import type { CompatGrade } from "../types.ts";

export type { CompatGrade };

function canonicalId(agentId: string): string {
  switch (agentId.trim()) {
    case "claude":
      return "claude-acp";
    case "codex":
      return "codex-acp";
    case "cursor":
      return "cursor-agent";
    case "pi":
      return "pi-acp";
    case "qodercli":
      return "qoder";
    default:
      return agentId.trim();
  }
}

/**
 * Runtime compatibility grade (docs/agent-compat.md §10).
 * Registry listing is not the same as a verified chat path.
 */
const BY_ID: Record<string, CompatGrade> = {
  opencode: "verified",
  "cursor-agent": "verified",
  "codex-acp": "verified",
  "claude-acp": "verified",
  "pi-acp": "experimental",
  qoder: "experimental",
  gemini: "standard-acp",
};

export function compatGradeFor(agentId: string): CompatGrade {
  const id = canonicalId(agentId);
  return BY_ID[id] ?? "standard-acp";
}

export const COMPAT_GRADE_LABEL: Record<CompatGrade, string> = {
  verified: "已验证",
  experimental: "实验",
  "standard-acp": "标准 ACP",
  unsupported: "不支持",
};
