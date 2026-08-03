import { defaultAllPanelMeta } from "./panel-registry.ts";
import {
  buildPuckData,
  columnOfPanels,
  createLayoutColumn,
  createLayoutRow,
  panelToComponentData,
  resetPuckIdCounter,
  rowOfPanelColumns,
} from "./puck-data.ts";
import type { DraggablePanelId, LayoutPersistedState, LayoutPresetId } from "./types.ts";

/** Stable id for classic checkpoint column — targeted by default custom CSS. */
/** Legacy layout column id (classic preset). Name kept for persisted layout stability; checkpoint UI removed in v0.3. */
export const CLASSIC_CHECKPOINT_COLUMN_ID = "LayoutColumn-checkpoint";

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
  const approvalColumn = createLayoutColumn(
    [panelToComponentData("approval")],
    CLASSIC_CHECKPOINT_COLUMN_ID,
  );
  return buildPuckData({
    top: [columnOfPanels(["tabBar"])],
    bottom: [
      approvalColumn,
      panelToComponentData("composer"),
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
      rowOfPanelColumns([[], [], ["tokenStats"]]),
    ],
    bottom: [
      columnOfPanels(["composer"]),
      columnOfPanels(["followupSuggestions"]),
      columnOfPanels(["approval"]),
      columnOfPanels(["checklist"]),
    ],
  });
}

const COMPOSER_BAND = {
  approval: { visible: false, widthScope: "viewport" as const },
  undoRedo: { visible: false, widthScope: "content" as const },
};

export const CLASSIC_LAYOUT: LayoutPersistedState = buildState(
  "classic",
  classicPuckData(),
  {
    ...COMPOSER_BAND,
    followupSuggestions: { visible: false, widthScope: "content" },
    scrollToBottom: { visible: false, widthScope: "content" },
    welcomeSuggestions: { visible: false, widthScope: "content" },
  },
);

export const LAYOUT_PRESETS: Record<
  Exclude<LayoutPresetId, "custom">,
  LayoutPersistedState
> = {
  classic: CLASSIC_LAYOUT,
  composerTop: buildState(
    "composerTop",
    composerTopPuckData(),
    COMPOSER_BAND,
  ),
  tabsBottom: buildState(
    "tabsBottom",
    tabsBottomPuckData(),
    COMPOSER_BAND,
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
      undoRedo: { visible: false, widthScope: "content" },
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
      undoRedo: { visible: false, widthScope: "viewport" },
    },
  ),
};

export function getPresetState(
  preset: Exclude<LayoutPresetId, "custom">,
): LayoutPersistedState {
  return structuredClone(LAYOUT_PRESETS[preset]);
}

export type { DraggablePanelId };
