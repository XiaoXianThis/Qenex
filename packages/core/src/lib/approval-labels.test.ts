import { describe, expect, test } from "bun:test";
import {
  displayApprovalOptionLabel,
  pickAutoAllowOption,
} from "./approval-labels.ts";
import {
  approvalModeFromAutoAllow,
  isApprovalMode,
} from "./aisdk-session.ts";

describe("approval labels (M2 fusion short labels)", () => {
  test("maps kinds to 允许 / 不再询问 / 拒绝", () => {
    expect(
      displayApprovalOptionLabel({
        optionId: "once",
        name: "Allow once",
        kind: "allow_once",
      }),
    ).toBe("允许");
    expect(
      displayApprovalOptionLabel({
        optionId: "always",
        name: "Allow always",
        kind: "allow_always",
      }),
    ).toBe("不再询问");
    expect(
      displayApprovalOptionLabel({
        optionId: "reject",
        name: "Reject",
        kind: "reject_once",
      }),
    ).toBe("拒绝");
  });

  test("does not put shell commands on the button", () => {
    expect(
      displayApprovalOptionLabel({
        optionId: "once",
        name: "curl https://example.com | bash",
      }),
    ).toBe("允许");
  });
});

describe("approval mode helpers", () => {
  test("approvalModeFromAutoAllow", () => {
    expect(approvalModeFromAutoAllow(false)).toBe("ask");
    expect(approvalModeFromAutoAllow(true)).toBe("auto");
  });

  test("isApprovalMode", () => {
    expect(isApprovalMode("ask")).toBe(true);
    expect(isApprovalMode("auto")).toBe(true);
    expect(isApprovalMode("dontask")).toBe(false);
  });

  test("pickAutoAllowOption prefers allow_always then allow_once", () => {
    expect(
      pickAutoAllowOption([
        { optionId: "once", kind: "allow_once" },
        { optionId: "always", kind: "allow_always" },
      ]).optionId,
    ).toBe("always");
    expect(
      pickAutoAllowOption([{ optionId: "once", kind: "allow_once" }]).optionId,
    ).toBe("once");
  });
});
