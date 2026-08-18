import { describe, expect, test } from "bun:test";
import {
  AcpToolOutputRecovery,
  extractAcpContentText,
  isEmptyToolRawOutput,
} from "../src/agent/runtime/acp-tool-output.ts";

describe("isEmptyToolRawOutput", () => {
  test("treats missing and empty containers as empty", () => {
    expect(isEmptyToolRawOutput(undefined)).toBe(true);
    expect(isEmptyToolRawOutput(null)).toBe(true);
    expect(isEmptyToolRawOutput("")).toBe(true);
    expect(isEmptyToolRawOutput({})).toBe(true);
    expect(isEmptyToolRawOutput([])).toBe(true);
    expect(isEmptyToolRawOutput({ formatted_output: "x" })).toBe(false);
    expect(isEmptyToolRawOutput("ok")).toBe(false);
  });
});

describe("extractAcpContentText", () => {
  test("unwraps nested ACP content blocks", () => {
    expect(
      extractAcpContentText([
        { type: "content", content: { type: "text", text: "hit" } },
      ]),
    ).toBe("hit");
  });
});

describe("AcpToolOutputRecovery", () => {
  test("fills completed empty rawOutput from in-progress content", () => {
    const recovery = new AcpToolOutputRecovery();
    recovery.patch({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "in_progress",
      content: [
        { type: "content", content: { type: "text", text: "chunk-a" } },
      ],
    });
    const done = recovery.patch({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      rawOutput: {},
      content: [],
    });
    expect(done?.rawOutput).toBe("chunk-a");
  });

  test("replaces cumulative snapshots instead of duplicating", () => {
    const recovery = new AcpToolOutputRecovery();
    recovery.patch({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "in_progress",
      content: [{ type: "text", text: "he" }],
    });
    recovery.patch({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "in_progress",
      content: [{ type: "text", text: "hello" }],
    });
    const done = recovery.patch({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      rawOutput: null,
    });
    expect(done?.rawOutput).toBe("hello");
  });

  test("failed empty rawOutput becomes iterable content", () => {
    const recovery = new AcpToolOutputRecovery();
    const failed = recovery.patch({
      sessionUpdate: "tool_call_update",
      toolCallId: "t2",
      status: "failed",
      rawOutput: {},
      content: [
        { type: "content", content: { type: "text", text: "nope" } },
      ],
    });
    expect(Array.isArray(failed?.rawOutput)).toBe(true);
  });

  test("keeps a real Codex formatted_output object", () => {
    const recovery = new AcpToolOutputRecovery();
    const payload = { formatted_output: "pwd\n", exit_code: 0 };
    const done = recovery.patch({
      sessionUpdate: "tool_call_update",
      toolCallId: "t3",
      status: "completed",
      rawOutput: payload,
    });
    expect(done?.rawOutput).toEqual(payload);
  });
});
