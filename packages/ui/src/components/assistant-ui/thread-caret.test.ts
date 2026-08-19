import { describe, expect, test } from "bun:test";
import {
  assistantMessageCaretVisible,
  isDuplicateLiveAssistant,
} from "./thread-caret.ts";

describe("isDuplicateLiveAssistant", () => {
  test("keeps the fallback while ThreadPrimitive has not mirrored the id", () => {
    expect(
      isDuplicateLiveAssistant({
        messageId: "asst-sdk",
        messages: [
          { id: "u1", role: "user" },
          { id: "asst-sdk", role: "assistant" },
        ],
        threadIds: ["u1"],
      }),
    ).toBe(false);
  });

  test("drops an orphan assistant once the in-thread row exists this turn", () => {
    expect(
      isDuplicateLiveAssistant({
        messageId: "asst-sdk",
        messages: [
          { id: "u1", role: "user" },
          { id: "asst-aui", role: "assistant" },
          { id: "asst-sdk", role: "assistant" },
        ],
        threadIds: ["u1", "asst-aui"],
      }),
    ).toBe(true);
  });
});

describe("assistantMessageCaretVisible", () => {
  test("shows on the last in-thread assistant while the turn is busy", () => {
    expect(
      assistantMessageCaretVisible({
        isLastThreadMessage: true,
        busy: true,
        lastChatRole: "assistant",
      }),
    ).toBe(true);
  });

  test("hides when a newer user message already owns the optimistic caret", () => {
    expect(
      assistantMessageCaretVisible({
        isLastThreadMessage: true,
        busy: true,
        lastChatRole: "user",
      }),
    ).toBe(false);
  });
});
