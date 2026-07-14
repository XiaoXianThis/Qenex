import { describe, expect, test } from "bun:test";
import type { ComponentData } from "@puckeditor/core";
import {
  layoutNodeHasVisiblePanel,
  layoutNodesHaveVisiblePanel,
} from "./layout-visibility.ts";
import type { PanelId, PanelMeta } from "./types.ts";

function panels(
  visible: Partial<Record<PanelId, boolean>>,
): Record<PanelId, PanelMeta> {
  const all: PanelId[] = [
    "tabBar",
    "messages",
    "composer",
    "followupSuggestions",
    "scrollToBottom",
    "welcomeSuggestions",
    "sessionConfigBar",
    "tokenStats",
    "undoRedo",
    "checklist",
    "approval",
  ];
  return Object.fromEntries(
    all.map((id) => [
      id,
      { visible: visible[id] ?? true, widthScope: "content" as const },
    ]),
  ) as Record<PanelId, PanelMeta>;
}

function panel(type: string, id: string): ComponentData {
  return { type, props: { id } };
}

function column(id: string, children: ComponentData[]): ComponentData {
  return { type: "LayoutColumn", props: { id, children } };
}

function row(id: string, children: ComponentData[]): ComponentData {
  return { type: "LayoutRow", props: { id, children } };
}

describe("layoutNodeHasVisiblePanel", () => {
  test("visible panel → true", () => {
    expect(
      layoutNodeHasVisiblePanel(
        panel("TabBar", "TabBar-1"),
        panels({ tabBar: true }),
      ),
    ).toBe(true);
  });

  test("hidden panel → false", () => {
    expect(
      layoutNodeHasVisiblePanel(
        panel("Approval", "Approval-1"),
        panels({ approval: false }),
      ),
    ).toBe(false);
  });

  test("row with one visible child → true", () => {
    const tree = row("LayoutRow-1", [
      column("LayoutColumn-1", [
        panel("Approval", "Approval-1"),
        panel("Composer", "Composer-1"),
      ]),
    ]);
    expect(
      layoutNodeHasVisiblePanel(
        tree,
        panels({ approval: false, composer: true }),
      ),
    ).toBe(true);
  });

  test("row with all children hidden → false", () => {
    const tree = row("LayoutRow-1", [
      column("LayoutColumn-1", [
        panel("Approval", "Approval-1"),
        panel("FollowupSuggestions", "FollowupSuggestions-1"),
      ]),
    ]);
    expect(
      layoutNodeHasVisiblePanel(
        tree,
        panels({ approval: false, followupSuggestions: false }),
      ),
    ).toBe(false);
  });

  test("empty column → false", () => {
    expect(
      layoutNodeHasVisiblePanel(column("LayoutColumn-1", []), panels({})),
    ).toBe(false);
  });

  test("inert panels (tokenStats/checklist) never count", () => {
    const tree = row("LayoutRow-1", [
      column("LayoutColumn-1", [panel("TokenStats", "TokenStats-1")]),
      column("LayoutColumn-2", [panel("Checklist", "Checklist-1")]),
    ]);
    expect(
      layoutNodeHasVisiblePanel(
        tree,
        panels({ tokenStats: true, checklist: true }),
      ),
    ).toBe(false);
  });

  test("undoRedo counts when visible", () => {
    expect(
      layoutNodeHasVisiblePanel(
        panel("UndoRedo", "UndoRedo-1"),
        panels({ undoRedo: true }),
      ),
    ).toBe(true);
  });

  test("nodes helper", () => {
    expect(
      layoutNodesHaveVisiblePanel(
        [panel("Approval", "Approval-1")],
        panels({ approval: false }),
      ),
    ).toBe(false);
    expect(
      layoutNodesHaveVisiblePanel(
        [
          panel("Approval", "Approval-1"),
          panel("Composer", "Composer-1"),
        ],
        panels({ approval: false, composer: true }),
      ),
    ).toBe(true);
  });
});
