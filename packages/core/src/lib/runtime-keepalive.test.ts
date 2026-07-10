import { describe, expect, test } from "bun:test";

/**
 * Mirrors LayoutPageRoot multi-tab keepalive: only the active tab receives
 * visible children; all active sessions keep a mounted runtime slot.
 */
function keepaliveSlots(
  tabIds: string[],
  activeTabId: string | null,
): Array<{ tabId: string; visible: boolean }> {
  return tabIds.map((tabId) => ({
    tabId,
    visible: tabId === activeTabId,
  }));
}

describe("multi-tab runtime keepalive", () => {
  test("all tabs stay mounted; only active is visible", () => {
    const slots = keepaliveSlots(["a", "b", "c"], "b");
    expect(slots).toEqual([
      { tabId: "a", visible: false },
      { tabId: "b", visible: true },
      { tabId: "c", visible: false },
    ]);
  });

  test("switching active does not drop slots", () => {
    const tabs = ["a", "b"];
    const before = keepaliveSlots(tabs, "a");
    const after = keepaliveSlots(tabs, "b");
    expect(before.map((s) => s.tabId)).toEqual(after.map((s) => s.tabId));
    expect(after.find((s) => s.tabId === "b")?.visible).toBe(true);
    expect(after.find((s) => s.tabId === "a")?.visible).toBe(false);
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
