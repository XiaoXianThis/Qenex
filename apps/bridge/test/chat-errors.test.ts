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
