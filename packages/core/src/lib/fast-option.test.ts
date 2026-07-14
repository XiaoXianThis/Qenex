import { describe, expect, it } from "vitest";
import {
  isFastOptionEnabled,
  oppositeFastOptionId,
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
});
