/**
 * Map chat-stream failures to actionable Chinese messages for the Web UI.
 * AI SDK defaults onError to "An error occurred." — we override that for local Bridge.
 */
export function formatChatStreamError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error == null
          ? ""
          : String(error);
  const message = raw.trim();
  const lower = message.toLowerCase();

  if (
    /insufficient\s*balance|余额不足|quota\s*exceeded|rate\s*limit|billing|payment.?required|credit/i.test(
      message,
    )
  ) {
    return "模型服务余额不足（Insufficient Balance）。请在 OpenCode 对应提供商账户充值，或切换已配置且有额度的模型后重试。";
  }

  if (
    /auth|login|unauthori[sz]ed|not authenticated|authentication|token expired|please\s+run\s+.*login|opencode\s+auth/i.test(
      lower,
    )
  ) {
    return "OpenCode 需要登录或凭证已失效。请在终端运行 `opencode auth login`（或对应提供商登录）后重试。";
  }

  if (
    /model.?not.?found|unknown.?model|no.?model|invalid.?model/i.test(lower)
  ) {
    return "当前模型不可用。请在 OpenCode 中配置可用模型后重试。";
  }

  if (!message || /^an error occurred\.?$/i.test(message)) {
    return "对话失败。请查看 Bridge 终端日志，并检查 OpenCode 登录状态与模型额度。";
  }

  const cleaned = message
    .replace(/^ACPError:\s*/i, "")
    .replace(/^Internal error:\s*/i, "")
    .replace(/^Upstream request failed:\s*/i, "")
    .replace(/^\[invalid_request_error\]\s*/i, "")
    .trim();

  return cleaned || message;
}
