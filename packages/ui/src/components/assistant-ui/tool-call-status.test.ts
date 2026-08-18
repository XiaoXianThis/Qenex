import { describe, expect, test } from "bun:test";
import { isToolCallShimmerActive } from "./tool-call-status.ts";

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
