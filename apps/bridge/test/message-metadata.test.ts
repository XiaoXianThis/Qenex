import { describe, expect, test } from "bun:test";
import { MessageMetadataAccumulator } from "../src/message-metadata.ts";

describe("MessageMetadataAccumulator", () => {
  test("accumulates multiple diffs (AI SDK array replace workaround)", () => {
    const acc = new MessageMetadataAccumulator();
    const first = acc.ingest({
      type: "raw",
      rawValue: JSON.stringify({
        type: "diff",
        path: "a.ts",
        oldText: "1",
        newText: "2",
        toolCallId: "t1",
      }),
    });
    const second = acc.ingest({
      type: "raw",
      rawValue: JSON.stringify({
        type: "diff",
        path: "b.ts",
        newText: "3",
        toolCallId: "t2",
      }),
    });
    expect(first?.diffs).toHaveLength(1);
    expect(second?.diffs).toHaveLength(2);
    expect(second?.diffs?.map((d) => d.path).sort()).toEqual(["a.ts", "b.ts"]);
  });

  test("upserts diff for same toolCallId+path", () => {
    const acc = new MessageMetadataAccumulator();
    acc.ingest({
      type: "raw",
      rawValue: JSON.stringify({
        type: "diff",
        path: "a.ts",
        newText: "v1",
        toolCallId: "t1",
      }),
    });
    const next = acc.ingest({
      type: "raw",
      rawValue: JSON.stringify({
        type: "diff",
        path: "a.ts",
        newText: "v2",
        toolCallId: "t1",
      }),
    });
    expect(next?.diffs).toHaveLength(1);
    expect(next?.diffs?.[0]?.newText).toBe("v2");
  });

  test("replaces plan entries wholesale", () => {
    const acc = new MessageMetadataAccumulator();
    acc.ingest({
      type: "raw",
      rawValue: JSON.stringify({
        type: "plan",
        entries: [{ content: "one", status: "pending", priority: "high" }],
      }),
    });
    const next = acc.ingest({
      type: "raw",
      rawValue: JSON.stringify({
        type: "plan",
        entries: [
          { content: "one", status: "completed", priority: "high" },
          { content: "two", status: "in_progress", priority: "medium" },
        ],
      }),
    });
    expect(next?.plan).toHaveLength(2);
    expect(next?.plan?.[0]?.status).toBe("completed");
  });

  test("accumulates terminals and ignores malformed raw", () => {
    const acc = new MessageMetadataAccumulator();
    expect(acc.ingest({ type: "raw", rawValue: "{not-json" })).toBeUndefined();
    expect(acc.ingest({ type: "text", rawValue: "x" })).toBeUndefined();
    expect(
      acc.ingest({
        type: "raw",
        rawValue: JSON.stringify({ type: "unknown", foo: 1 }),
      }),
    ).toBeUndefined();
    const meta = acc.ingest({
      type: "raw",
      rawValue: {
        type: "terminal",
        terminalId: "term-1",
        toolCallId: "t9",
      },
    });
    expect(meta?.terminals).toEqual([
      { type: "terminal", terminalId: "term-1", toolCallId: "t9" },
    ]);
  });

  test("client mergeObjects-style replace keeps full accumulated diffs", () => {
    // Mirrors AI SDK mergeObjects: arrays are replaced, not concatenated.
    const merge = (
      base: Record<string, unknown> | undefined,
      next: Record<string, unknown> | undefined,
    ) => {
      if (!base) return next;
      if (!next) return base;
      return { ...base, ...next };
    };
    const acc = new MessageMetadataAccumulator();
    let meta: Record<string, unknown> | undefined;
    for (const part of [
      {
        type: "raw",
        rawValue: JSON.stringify({
          type: "diff",
          path: "a.ts",
          newText: "1",
          toolCallId: "t1",
        }),
      },
      {
        type: "raw",
        rawValue: JSON.stringify({
          type: "plan",
          entries: [{ content: "do a", status: "pending" }],
        }),
      },
      {
        type: "raw",
        rawValue: JSON.stringify({
          type: "diff",
          path: "b.ts",
          newText: "2",
          toolCallId: "t2",
        }),
      },
    ]) {
      meta = merge(
        meta,
        acc.ingest(part) as Record<string, unknown> | undefined,
      );
    }
    expect((meta?.diffs as unknown[])?.length).toBe(2);
    expect((meta?.plan as unknown[])?.length).toBe(1);
  });
});
