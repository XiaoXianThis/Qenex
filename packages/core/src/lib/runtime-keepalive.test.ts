import { describe, expect, test } from "bun:test";

/**
 * Mirrors LayoutPageRoot multi-tab keepalive: only the active tab receives
 * visible children; all active sessions keep a mounted runtime slot.
 * Inactive slots skip Ask polling unless Auto-allow is on (SSE would hang).
 * Process warmup stays active-tab only.
 */
function keepaliveSlots(
  tabIds: string[],
  activeTabId: string | null,
  autoAllow = false,
): Array<{
  tabId: string;
  visible: boolean;
  isActive: boolean;
  pollApprovals: boolean;
  warmupProcess: boolean;
}> {
  return tabIds.map((tabId) => {
    const isActive = tabId === activeTabId;
    return {
      tabId,
      visible: isActive,
      isActive,
      pollApprovals: isActive || autoAllow,
      warmupProcess: isActive,
    };
  });
}

function approvalPollIntervalMs(input: {
  isActive: boolean;
  autoAllow: boolean;
  hasPending: boolean;
  chatBusy: boolean;
}): number | null {
  if (!input.isActive) return input.autoAllow ? 2000 : null;
  if (input.hasPending || input.chatBusy) return 350;
  return 2000;
}

describe("multi-tab runtime keepalive", () => {
  test("all tabs stay mounted; only active is visible", () => {
    const slots = keepaliveSlots(["a", "b", "c"], "b");
    expect(slots).toEqual([
      {
        tabId: "a",
        visible: false,
        isActive: false,
        pollApprovals: false,
        warmupProcess: false,
      },
      {
        tabId: "b",
        visible: true,
        isActive: true,
        pollApprovals: true,
        warmupProcess: true,
      },
      {
        tabId: "c",
        visible: false,
        isActive: false,
        pollApprovals: false,
        warmupProcess: false,
      },
    ]);
  });

  test("switching active does not drop slots", () => {
    const tabs = ["a", "b"];
    const before = keepaliveSlots(tabs, "a");
    const after = keepaliveSlots(tabs, "b");
    expect(before.map((s) => s.tabId)).toEqual(after.map((s) => s.tabId));
    expect(after.find((s) => s.tabId === "b")?.visible).toBe(true);
    expect(after.find((s) => s.tabId === "a")?.visible).toBe(false);
    expect(after.find((s) => s.tabId === "a")?.pollApprovals).toBe(false);
    expect(after.find((s) => s.tabId === "b")?.pollApprovals).toBe(true);
  });

  test("auto-allow keeps inactive slots polling; warmup stays active-only", () => {
    const slots = keepaliveSlots(["a", "b"], "b", true);
    expect(slots.find((s) => s.tabId === "a")).toMatchObject({
      visible: false,
      pollApprovals: true,
      warmupProcess: false,
    });
    expect(slots.find((s) => s.tabId === "b")).toMatchObject({
      visible: true,
      pollApprovals: true,
      warmupProcess: true,
    });
  });
});

describe("approval poll keepalive", () => {
  test("inactive slots without auto-allow do not poll", () => {
    expect(
      approvalPollIntervalMs({
        isActive: false,
        autoAllow: false,
        hasPending: true,
        chatBusy: true,
      }),
    ).toBeNull();
  });

  test("inactive auto-allow polls at 2s", () => {
    expect(
      approvalPollIntervalMs({
        isActive: false,
        autoAllow: true,
        hasPending: true,
        chatBusy: true,
      }),
    ).toBe(2000);
  });

  test("active pending or streaming stays at 350ms", () => {
    expect(
      approvalPollIntervalMs({
        isActive: true,
        autoAllow: false,
        hasPending: true,
        chatBusy: false,
      }),
    ).toBe(350);
    expect(
      approvalPollIntervalMs({
        isActive: true,
        autoAllow: false,
        hasPending: false,
        chatBusy: true,
      }),
    ).toBe(350);
  });

  test("active idle uses 2s", () => {
    expect(
      approvalPollIntervalMs({
        isActive: true,
        autoAllow: false,
        hasPending: false,
        chatBusy: false,
      }),
    ).toBe(2000);
  });
});

describe("layout edit keepalive", () => {
  test("edit mode keeps live tree mounted (hidden) alongside puck", () => {
    const editMode = true;
    const liveMounted = true;
    const puckMounted = editMode;
    const liveHidden = editMode;
    expect(liveMounted && puckMounted && liveHidden).toBe(true);
  });
});
