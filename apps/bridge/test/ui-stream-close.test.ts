import { describe, expect, test } from "bun:test";
import { closeOpenUiPartsTransform } from "../src/ui-stream-close.ts";

async function run(
  chunks: Array<{ type: string; id?: string; delta?: string }>,
) {
  const input = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const out: Array<{ type: string; id?: string }> = [];
  const reader = input.pipeThrough(closeOpenUiPartsTransform()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push({ type: value.type, id: value.id });
  }
  return out;
}

describe("closeOpenUiPartsTransform", () => {
  test("injects text-end before finish-step when provider omitted it", async () => {
    const out = await run([
      { type: "start" },
      { type: "text-start", id: "text - 0 " },
      { type: "text-delta", id: "text - 0 ", delta: "pong" },
      { type: "finish-step" },
      { type: "finish" },
    ]);
    const types = out.map((c) => c.type);
    expect(types).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);
    expect(out[3]).toEqual({ type: "text-end", id: "text - 0 " });
  });

  test("does not duplicate text-end when already present", async () => {
    const out = await run([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "ok" },
      { type: "text-end", id: "t1" },
      { type: "finish-step" },
      { type: "finish" },
    ]);
    expect(out.filter((c) => c.type === "text-end")).toHaveLength(1);
  });

  test("closes open reasoning before finish", async () => {
    const out = await run([
      { type: "reasoning-start", id: "r1" },
      { type: "finish" },
    ]);
    expect(out.map((c) => c.type)).toEqual([
      "reasoning-start",
      "reasoning-end",
      "finish",
    ]);
  });
});
