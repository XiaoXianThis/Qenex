import { describe, expect, test } from "bun:test";
import {
  stableStreamChunk,
  trackOpenTools,
  withChatIdleTimeout,
  withSseKeepalive,
} from "../src/chat.ts";

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

describe("trackOpenTools", () => {
  test("pauses across start/available for the same tool id", () => {
    const open = new Set<string>();
    trackOpenTools(open, { type: "tool-input-start", id: "call_1" });
    expect(open.size).toBe(1);
    trackOpenTools(open, { type: "tool-input-available", toolCallId: "call_1" });
    expect(open.size).toBe(1);
    trackOpenTools(open, {
      type: "tool-output-available",
      toolCallId: "call_1",
    });
    expect(open.size).toBe(0);
  });

  test("keeps the set open until every parallel tool closes", () => {
    const open = new Set<string>();
    trackOpenTools(open, { type: "tool-input-start", id: "a" });
    trackOpenTools(open, { type: "tool-input-start", id: "b" });
    trackOpenTools(open, { type: "tool-result", toolCallId: "a" });
    expect(open.has("b")).toBe(true);
    trackOpenTools(open, { type: "tool-output-error", toolCallId: "b" });
    expect(open.size).toBe(0);
  });
});

describe("chat stream idle timeout", () => {
  test("errors and aborts a stream that produces no data", async () => {
    const source = new ReadableStream<string>({
      start() {
        // Deliberately never enqueue or close.
      },
    });
    const captured: { error: Error | null } = { error: null };
    const reader = withChatIdleTimeout(source, 10, (error) => {
      captured.error = error;
    }).getReader();

    await expect(reader.read()).rejects.toThrow("produced no data");
    expect(captured.error?.name).toBe("ChatIdleTimeoutError");
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

  test("does not idle-timeout while a tool call is in flight", async () => {
    let push!: (chunk: { type: string; id?: string; toolCallId?: string }) => void;
    let close!: () => void;
    const source = new ReadableStream<{
      type: string;
      id?: string;
      toolCallId?: string;
    }>({
      start(controller) {
        push = (chunk) => controller.enqueue(chunk);
        close = () => controller.close();
      },
    });
    let timedOut = false;
    const reader = withChatIdleTimeout(source, 40, () => {
      timedOut = true;
    }).getReader();

    push({ type: "tool-input-start", id: "t1" });
    expect(await reader.read()).toMatchObject({
      value: { type: "tool-input-start" },
      done: false,
    });
    await Bun.sleep(80);
    expect(timedOut).toBe(false);

    push({ type: "tool-output-available", toolCallId: "t1" });
    expect(await reader.read()).toMatchObject({
      value: { type: "tool-output-available" },
      done: false,
    });
    close();
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    expect(timedOut).toBe(false);
  });

  test("idles after the in-flight tool closes and no more chunks arrive", async () => {
    let push!: (chunk: { type: string; id?: string; toolCallId?: string }) => void;
    const source = new ReadableStream<{
      type: string;
      id?: string;
      toolCallId?: string;
    }>({
      start(controller) {
        push = (chunk) => controller.enqueue(chunk);
      },
    });
    const captured: { error: Error | null } = { error: null };
    const reader = withChatIdleTimeout(source, 30, (error) => {
      captured.error = error;
    }).getReader();

    push({ type: "tool-input-start", id: "t1" });
    await reader.read();
    push({ type: "tool-result", toolCallId: "t1" });
    await reader.read();
    await expect(reader.read()).rejects.toThrow("produced no data");
    expect(captured.error?.name).toBe("ChatIdleTimeoutError");
  });
});

describe("SSE keepalive wrapper", () => {
  test("forwards body bytes and injects comment frames", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const inner = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: hello\n\n"));
      },
    });
    const wrapped = withSseKeepalive(
      new Response(inner, {
        headers: { "content-type": "text/event-stream" },
      }),
      20,
    );
    const reader = wrapped.body!.getReader();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("data: hello");

    const deadline = Date.now() + 200;
    let sawKeepalive = false;
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        Bun.sleep(30).then(() => null),
      ]);
      if (!next || next.done) continue;
      if (decoder.decode(next.value).includes(": keepalive")) {
        sawKeepalive = true;
        break;
      }
    }
    expect(sawKeepalive).toBe(true);
    await reader.cancel();
  });
});
