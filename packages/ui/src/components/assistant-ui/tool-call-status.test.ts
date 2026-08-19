import { describe, expect, test } from "bun:test";
import {
  isToolCallShimmerActive,
  isTrailingToolGroup,
  toolGroupShouldAutoOpen,
} from "./tool-call-status.ts";

describe("isToolCallShimmerActive", () => {
  test("running with no result shimmers while the turn is in flight", () => {
    expect(
      isToolCallShimmerActive({ status: { type: "running" } }, true),
    ).toBe(true);
  });

  test("running with no result does not shimmer after the stream closes", () => {
    expect(
      isToolCallShimmerActive({ status: { type: "running" } }, false),
    ).toBe(false);
  });

  test("empty-string / null results stop the swipe even if status is stuck running", () => {
    expect(
      isToolCallShimmerActive(
        { status: { type: "running" }, result: "" },
        true,
      ),
    ).toBe(false);
    expect(
      isToolCallShimmerActive(
        { status: { type: "running" }, result: null },
        true,
      ),
    ).toBe(false);
  });

  test("complete and incomplete never shimmer", () => {
    expect(
      isToolCallShimmerActive({ status: { type: "complete" } }, true),
    ).toBe(false);
    expect(
      isToolCallShimmerActive(
        { status: { type: "incomplete" }, result: undefined },
        true,
      ),
    ).toBe(false);
  });

  test("requires-action without a result still shimmers (approval / pending)", () => {
    expect(
      isToolCallShimmerActive(
        { status: { type: "requires-action" } },
        false,
      ),
    ).toBe(true);
  });

  test("requires-action with a result has already returned", () => {
    expect(
      isToolCallShimmerActive(
        { status: { type: "requires-action" }, result: { ok: true } },
        true,
      ),
    ).toBe(false);
  });

  test("isError stops the swipe", () => {
    expect(
      isToolCallShimmerActive(
        { status: { type: "running" }, isError: true },
        true,
      ),
    ).toBe(false);
  });
});

describe("toolGroupShouldAutoOpen", () => {
  test("stays open between sequential tools while the turn is busy", () => {
    expect(
      toolGroupShouldAutoOpen({
        anyToolActive: false,
        chatBusy: true,
        trailing: true,
      }),
    ).toBe(true);
  });

  test("collapses after the model moves on to text", () => {
    expect(
      toolGroupShouldAutoOpen({
        anyToolActive: false,
        chatBusy: true,
        trailing: false,
      }),
    ).toBe(false);
  });

  test("collapses when the turn is idle", () => {
    expect(
      toolGroupShouldAutoOpen({
        anyToolActive: false,
        chatBusy: false,
        trailing: true,
      }),
    ).toBe(false);
  });
});

describe("isTrailingToolGroup", () => {
  test("treats empty trailing text as still trailing", () => {
    expect(
      isTrailingToolGroup(
        [
          { type: "tool-call" },
          { type: "tool-call" },
          { type: "text", text: "" },
        ],
        1,
      ),
    ).toBe(true);
  });

  test("a following text part ends the group", () => {
    expect(
      isTrailingToolGroup(
        [
          { type: "tool-call" },
          { type: "tool-call" },
          { type: "text", text: "done" },
        ],
        1,
      ),
    ).toBe(false);
  });
});
