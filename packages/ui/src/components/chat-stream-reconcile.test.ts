import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  messageTextLength,
  persistedMessageIsRicher,
  shouldReconcileChatFinish,
} from "./chat-stream-reconcile.ts";

const assistant = (
  text: string,
  extraParts: UIMessage["parts"] = [],
): UIMessage => ({
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text }, ...extraParts],
});

describe("chat stream reconcile", () => {
  test("messageTextLength sums text parts", () => {
    expect(messageTextLength(assistant("hi"))).toBe(2);
    expect(messageTextLength(undefined)).toBe(0);
  });

  test("does not reconcile a user-initiated abort", () => {
    expect(
      shouldReconcileChatFinish({
        isAbort: true,
        isDisconnect: false,
        isError: false,
        message: assistant("partial"),
      }),
    ).toBe(false);
  });

  test("reconciles disconnect and stream errors so SQLite can fill in", () => {
    expect(
      shouldReconcileChatFinish({
        isAbort: false,
        isDisconnect: true,
        isError: false,
        message: assistant("partial"),
      }),
    ).toBe(true);
    expect(
      shouldReconcileChatFinish({
        isAbort: false,
        isDisconnect: false,
        isError: true,
        message: assistant("partial"),
      }),
    ).toBe(true);
  });

  test("successful finish only reconciles empty assistant text", () => {
    expect(
      shouldReconcileChatFinish({
        isAbort: false,
        isDisconnect: false,
        isError: false,
        message: assistant("done"),
      }),
    ).toBe(false);
    expect(
      shouldReconcileChatFinish({
        isAbort: false,
        isDisconnect: false,
        isError: false,
        message: assistant(""),
      }),
    ).toBe(true);
  });

  test("persistedMessageIsRicher prefers longer text or more parts", () => {
    expect(persistedMessageIsRicher(assistant("hello world"), assistant("hello"))).toBe(
      true,
    );
    expect(persistedMessageIsRicher(assistant("hello"), assistant("hello world"))).toBe(
      false,
    );
    expect(
      persistedMessageIsRicher(
        assistant("same", [{ type: "text", text: "" }]),
        assistant("same"),
      ),
    ).toBe(true);
  });
});
