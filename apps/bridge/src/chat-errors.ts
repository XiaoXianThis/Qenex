/**
 * Map chat-stream failures to actionable Chinese messages for the Web UI.
 * AI SDK defaults onError to "An error occurred." — we override that for local Bridge.
 */
import { resolveAgentCompat } from "./agent/compat/registry.ts";
import { errorText } from "./agent/compat/types.ts";

const AGENT_LABELS: Record<string, string> = {
  opencode: "OpenCode",
  "claude-acp": "Claude Agent",
  "codex-acp": "Codex",
  "cursor-agent": "Cursor",
  devin: "Devin",
  gemini: "Gemini CLI",
  "pi-acp": "pi ACP",
  qoder: "Qoder CLI",
};

function agentLabel(agentId: string): string {
  return (AGENT_LABELS[agentId] ?? agentId) || "Agent";
}

function messageForClassifiedCode(
  code: string,
  label: string,
): string | null {
  switch (code) {
    case "opencode_auth_required":
      return "OpenCode 需要登录或凭证已失效。请在终端运行 `opencode auth login`（或对应提供商登录）后重试。";
    case "auth_required":
      return `${label} 需要登录或凭证已失效。请完成该 Agent 的登录后重试。`;
    case "quota_exceeded":
      return `模型服务余额不足（Insufficient Balance）。请检查 ${label} 对应提供商的额度，或切换已配置且有额度的模型后重试。`;
    case "model_unavailable":
      return `当前模型不可用。请在 ${label} 中配置可用模型后重试。`;
    default:
      return null;
  }
}

export function formatChatStreamError(
  error: unknown,
  agentId = "opencode",
): string {
  const message = errorText(error).trim();
  const lower = message.toLowerCase();
  const label = agentLabel(agentId);
  const classified = resolveAgentCompat(agentId).classifyError?.(error, "chat");
  const fromCompat = classified
    ? messageForClassifiedCode(classified.code, label)
    : null;
  if (fromCompat) return fromCompat;

  if (
    /insufficient\s*balance|余额不足|quota\s*exceeded|rate\s*limit|billing|payment.?required|credit/i.test(
      message,
    )
  ) {
    return `模型服务余额不足（Insufficient Balance）。请检查 ${label} 对应提供商的额度，或切换已配置且有额度的模型后重试。`;
  }

  if (
    /auth|login|unauthori[sz]ed|not authenticated|authentication|token expired|please\s+run\s+.*login|opencode\s+auth/i.test(
      lower,
    )
  ) {
    return `${label} 需要登录或凭证已失效。请完成该 Agent 的登录后重试。`;
  }

  if (
    /model.?not.?found|unknown.?model|no.?model|invalid.?model/i.test(lower)
  ) {
    return `当前模型不可用。请在 ${label} 中配置可用模型后重试。`;
  }

  if (!message || /^an error occurred\.?$/i.test(message)) {
    return `对话失败。请查看 Bridge 终端日志，并检查 ${label} 的登录状态与模型额度。`;
  }

  const cleaned = message
    .replace(/^ACPError:\s*/i, "")
    .replace(/^Internal error:\s*/i, "")
    .replace(/^Upstream request failed:\s*/i, "")
    .replace(/^\[invalid_request_error\]\s*/i, "")
    .trim();

  return cleaned || message;
}
