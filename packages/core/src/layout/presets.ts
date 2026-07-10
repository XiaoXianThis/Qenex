import { defaultAllPanelMeta } from "./panel-registry.ts";
import {
  buildPuckData,
  columnOfPanels,
  createLayoutRow,
  panelToComponentData,
  resetPuckIdCounter,
  rowOfPanelColumns,
} from "./puck-data.ts";
import type { DraggablePanelId, LayoutPersistedState, LayoutPresetId } from "./types.ts";

function buildState(
  preset: Exclude<LayoutPresetId, "custom">,
  puckData: ReturnType<typeof buildPuckData>,
  panelOverrides?: Parameters<typeof defaultAllPanelMeta>[0],
): LayoutPersistedState {
  return {
    schemaVersion: 4,
    preset,
    puckData,
    panels: defaultAllPanelMeta(panelOverrides),
  };
}

function classicPuckData() {
  resetPuckIdCounter();
  return buildPuckData({
    top: [columnOfPanels(["tabBar"])],
    bottom: [
      columnOfPanels([
        "followupSuggestions",
        "scrollToBottom",
        "approval",
        "composer",
        "welcomeSuggestions",
      ]),
    ],
  });
}

function composerTopPuckData() {
  resetPuckIdCounter();
  return buildPuckData({
    top: [columnOfPanels(["tabBar", "composer"])],
    bottom: [
      columnOfPanels([
        "followupSuggestions",
        "scrollToBottom",
        "approval",
        "welcomeSuggestions",
      ]),
    ],
  });
}

function tabsBottomPuckData() {
  resetPuckIdCounter();
  return buildPuckData({
    top: [],
    bottom: [
      columnOfPanels([
        "tabBar",
        "followupSuggestions",
        "scrollToBottom",
        "approval",
        "composer",
        "welcomeSuggestions",
      ]),
    ],
  });
}

function minimalPuckData() {
  resetPuckIdCounter();
  return buildPuckData({
    top: [columnOfPanels(["tabBar"])],
    bottom: [columnOfPanels(["approval", "composer"])],
  });
}

function workspacePuckData() {
  resetPuckIdCounter();
  return buildPuckData({
    top: [
      createLayoutRow([panelToComponentData("tabBar")]),
      rowOfPanelColumns([[], ["undoRedo"], ["tokenStats"]]),
    ],
    bottom: [
      columnOfPanels(["composer"]),
      columnOfPanels(["followupSuggestions"]),
      columnOfPanels(["approval"]),
      columnOfPanels(["checklist"]),
    ],
  });
}

const APPROVAL_HIDDEN = {
  approval: { visible: false, widthScope: "viewport" as const },
};

export const CLASSIC_LAYOUT: LayoutPersistedState = buildState(
  "classic",
  classicPuckData(),
  APPROVAL_HIDDEN,
);

export const LAYOUT_PRESETS: Record<
  Exclude<LayoutPresetId, "custom">,
  LayoutPersistedState
> = {
  classic: CLASSIC_LAYOUT,
  composerTop: buildState(
    "composerTop",
    composerTopPuckData(),
    APPROVAL_HIDDEN,
  ),
  tabsBottom: buildState(
    "tabsBottom",
    tabsBottomPuckData(),
    APPROVAL_HIDDEN,
  ),
  minimal: buildState(
    "minimal",
    minimalPuckData(),
    {
      followupSuggestions: { visible: false, widthScope: "content" },
      scrollToBottom: { visible: false, widthScope: "content" },
      welcomeSuggestions: { visible: false, widthScope: "content" },
      sessionConfigBar: { visible: false, widthScope: "content" },
      tokenStats: { visible: false, widthScope: "viewport" },
      undoRedo: { visible: false, widthScope: "viewport" },
      checklist: { visible: false, widthScope: "viewport" },
      approval: { visible: false, widthScope: "viewport" },
    },
  ),
  workspace: buildState(
    "workspace",
    workspacePuckData(),
    {
      approval: { visible: false, widthScope: "viewport" },
      scrollToBottom: { visible: false, widthScope: "content" },
      welcomeSuggestions: { visible: false, widthScope: "content" },
    },
  ),
};

export function getPresetState(
  preset: Exclude<LayoutPresetId, "custom">,
): LayoutPersistedState {
  return structuredClone(LAYOUT_PRESETS[preset]);
}

export type { DraggablePanelId };
