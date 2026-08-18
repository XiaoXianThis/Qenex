import { describe, expect, test } from "bun:test";
import {
  APPROVAL_POLL_ACTIVE_MS,
  APPROVAL_POLL_IDLE_MS,
  approvalPollIntervalMs,
} from "./ApprovalPollBridge.tsx";

describe("approvalPollIntervalMs", () => {
  test("inactive without auto-allow does not poll", () => {
    expect(
      approvalPollIntervalMs({
        isActive: false,
        autoAllow: false,
        hasPending: true,
        chatBusy: true,
      }),
    ).toBeNull();
  });

  test("inactive auto-allow still polls at 2s so background Ask is drained", () => {
    expect(
      approvalPollIntervalMs({
        isActive: false,
        autoAllow: true,
        hasPending: true,
        chatBusy: true,
      }),
    ).toBe(APPROVAL_POLL_IDLE_MS);
    expect(
      approvalPollIntervalMs({
        isActive: false,
        autoAllow: true,
        hasPending: false,
        chatBusy: false,
      }),
    ).toBe(APPROVAL_POLL_IDLE_MS);
    expect(APPROVAL_POLL_IDLE_MS).toBe(2000);
  });

  test("active pending or streaming uses 350ms", () => {
    expect(
      approvalPollIntervalMs({
        isActive: true,
        autoAllow: false,
        hasPending: true,
        chatBusy: false,
      }),
    ).toBe(APPROVAL_POLL_ACTIVE_MS);
    expect(
      approvalPollIntervalMs({
        isActive: true,
        autoAllow: false,
        hasPending: false,
        chatBusy: true,
      }),
    ).toBe(APPROVAL_POLL_ACTIVE_MS);
    expect(APPROVAL_POLL_ACTIVE_MS).toBe(350);
  });

  test("active idle uses 2s", () => {
    expect(
      approvalPollIntervalMs({
        isActive: true,
        autoAllow: false,
        hasPending: false,
        chatBusy: false,
      }),
    ).toBe(APPROVAL_POLL_IDLE_MS);
  });
});
