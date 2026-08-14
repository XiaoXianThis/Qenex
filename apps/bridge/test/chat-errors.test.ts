import { describe, expect, test } from "bun:test";
import { formatChatStreamError } from "../src/chat-errors.ts";

describe("formatChatStreamError", () => {
  test("maps Insufficient Balance", () => {
    const msg = formatChatStreamError(
      new Error(
        "Internal error: Upstream request failed: [invalid_request_error] Insufficient Balance",
      ),
    );
    expect(msg).toContain("余额不足");
    expect(msg).toContain("Insufficient Balance");
  });

  test("maps auth failures", () => {
    expect(formatChatStreamError(new Error("Please run opencode auth login"))).toContain(
      "登录",
    );
  });

  test("attributes auth failures to the active agent", () => {
    const msg = formatChatStreamError(
      new Error("Authentication token expired"),
      "devin",
    );
    expect(msg).toContain("Devin");
    expect(msg).not.toContain("OpenCode");
  });

  test("maps JSON-RPC model-not-found without [object Object]", () => {
    const msg = formatChatStreamError(
      { code: -32602, message: "Invalid params: model not found: structure/openai/gpt-5.6-sol" },
      "opencode",
    );
    expect(msg).toContain("当前模型不可用");
    expect(msg).not.toContain("[object Object]");
  });

  test("maps nested token expiry as auth", () => {
    const msg = formatChatStreamError(
      { message: "Internal error", data: { details: "token expired" } },
      "gemini",
    );
    expect(msg).toContain("Gemini");
    expect(msg).toContain("登录");
  });

  test("replaces opaque AI SDK default", () => {
    expect(formatChatStreamError(new Error("An error occurred."))).toContain(
      "对话失败",
    );
  });

  test("keeps other useful messages cleaned", () => {
    expect(
      formatChatStreamError(
        new Error("ACPError: Internal error: Upstream request failed: boom"),
      ),
    ).toBe("boom");
  });
});
