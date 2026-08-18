import { describe, expect, it } from "vitest";
import {
  isFastOptionEnabled,
  isToggleOptionEnabled,
  oppositeFastOptionId,
  oppositeToggleOptionId,
} from "./bridge-api.ts";

describe("fast option helpers", () => {
  it("detects enabled fast values", () => {
    expect(isFastOptionEnabled("true")).toBe(true);
    expect(isFastOptionEnabled("FAST")).toBe(true);
    expect(isFastOptionEnabled("false")).toBe(false);
    expect(isFastOptionEnabled(null)).toBe(false);
  });

  it("picks the opposite fast option id", () => {
    const options = [
      { id: "false", name: "Off" },
      { id: "true", name: "On" },
    ];
    expect(oppositeFastOptionId(options, "false")).toBe("true");
    expect(oppositeFastOptionId(options, "true")).toBe("false");
    expect(oppositeFastOptionId([], "true")).toBeNull();
  });

  it("treats none/off as thinking disabled", () => {
    expect(isToggleOptionEnabled("none")).toBe(false);
    expect(isToggleOptionEnabled("off")).toBe(false);
    expect(isToggleOptionEnabled("medium")).toBe(true);
    expect(isToggleOptionEnabled("on")).toBe(true);
    expect(
      oppositeToggleOptionId(
        [
          { id: "none", name: "Off" },
          { id: "high", name: "On" },
        ],
        "none",
      ),
    ).toBe("high");
  });
});
