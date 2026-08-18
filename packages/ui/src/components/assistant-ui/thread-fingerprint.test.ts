import { describe, expect, test } from "bun:test";
import { threadMessagesFingerprint } from "./thread-fingerprint.ts";

describe("threadMessagesFingerprint", () => {
  test("empty thread", () => {
    expect(threadMessagesFingerprint([])).toBe("0:");
  });

  test("uses length and last id", () => {
    expect(
      threadMessagesFingerprint([{ id: "a" }, { id: "b" }, { id: "c" }]),
    ).toBe("3:c");
  });

  test("same last id different length is distinct", () => {
    expect(threadMessagesFingerprint([{ id: "a" }])).toBe("1:a");
    expect(threadMessagesFingerprint([{ id: "x" }, { id: "a" }])).toBe("2:a");
  });
});
