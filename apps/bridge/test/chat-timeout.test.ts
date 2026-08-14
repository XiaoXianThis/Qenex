import { describe, expect, test } from "bun:test";
import { stableStreamChunk, withChatIdleTimeout } from "../src/chat.ts";

describe("stable stream chunking", () => {
  test("reconstructs fast mixed-language output without losing code units", () => {
    const source =
      "第一段很快。Second block arrives immediately. 🚀第三段也必须完整。\n最后一行。";
    const chunks: string[] = [];
    let buffer = source;
    for (;;) {
      const chunk = stableStreamChunk(buffer);
      if (!chunk) break;
      chunks.push(chunk);
      buffer = buffer.slice(chunk.length);
    }
    chunks.push(buffer);

    expect(chunks.join("")).toBe(source);
    expect(chunks.every((chunk) => !chunk.endsWith("\ud83d"))).toBe(true);
  });
});

describe("chat stream idle timeout", () => {
  test("errors and aborts a stream that produces no data", async () => {
    const source = new ReadableStream<string>({
      start() {
        // Deliberately never enqueue or close.
      },
    });
    let timeoutError: Error | null = null;
    const reader = withChatIdleTimeout(source, 10, (error) => {
      timeoutError = error;
    }).getReader();

    await expect(reader.read()).rejects.toThrow("produced no data");
    expect(timeoutError?.name).toBe("ChatIdleTimeoutError");
  });

  test("passes chunks through and clears the timer on close", async () => {
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("ok");
        controller.close();
      },
    });
    let timedOut = false;
    const reader = withChatIdleTimeout(source, 50, () => {
      timedOut = true;
    }).getReader();

    expect(await reader.read()).toEqual({ value: "ok", done: false });
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    await Bun.sleep(60);
    expect(timedOut).toBe(false);
  });
});
