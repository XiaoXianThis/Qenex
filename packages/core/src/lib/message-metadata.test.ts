import { describe, expect, test } from "bun:test";
import { parseMessageMetadata } from "./message-metadata.ts";

describe("parseMessageMetadata", () => {
  test("returns undefined for junk", () => {
    expect(parseMessageMetadata(null)).toBeUndefined();
    expect(parseMessageMetadata({})).toBeUndefined();
    expect(parseMessageMetadata({ plan: "nope" })).toBeUndefined();
  });

  test("parses plan / diffs / terminals defensively", () => {
    const parsed = parseMessageMetadata({
      plan: [
        { content: "step 1", status: "completed" },
        { content: 1 },
        null,
      ],
      diffs: [
        { path: "a.ts", newText: "x", oldText: "y", toolCallId: "t1" },
        { path: "bad" },
      ],
      terminals: [{ terminalId: "term-1" }, { terminalId: 2 }],
    });
    expect(parsed?.plan).toEqual([{ content: "step 1", status: "completed" }]);
    expect(parsed?.diffs).toEqual([
      {
        type: "diff",
        path: "a.ts",
        newText: "x",
        oldText: "y",
        toolCallId: "t1",
      },
    ]);
    expect(parsed?.terminals).toEqual([{ type: "terminal", terminalId: "term-1" }]);
  });
});
