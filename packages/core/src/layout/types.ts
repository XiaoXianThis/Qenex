import type { Data } from "@puckeditor/core";

export type WidthScope = "viewport" | "content";
export type LayoutZone = "top" | "bottom";

export type PanelId =
  | "tabBar"
  | "messages"
  | "composer"
  | "followupSuggestions"
  | "scrollToBottom"
  | "welcomeSuggestions"
  | "sessionConfigBar"
  | "tokenStats"
  | "undoRedo"
  | "checklist"
  | "approval";

export type DraggablePanelId = Exclude<PanelId, "messages" | "sessionConfigBar">;

export type PanelMeta = {
  visible: boolean;
  widthScope: WidthScope;
};

export type LayoutPresetId =
  | "classic"
  | "composerTop"
  | "tabsBottom"
  | "minimal"
  | "workspace"
  | "custom";

export type LayoutPersistedState = {
  schemaVersion: 4;
  preset: LayoutPresetId;
  puckData: Data;
  panels: Record<PanelId, PanelMeta>;
};

export const PUCK_PANEL_TYPE: Record<DraggablePanelId, string> = {
  tabBar: "TabBar",
  composer: "Composer",
  followupSuggestions: "FollowupSuggestions",
  scrollToBottom: "ScrollToBottom",
  welcomeSuggestions: "WelcomeSuggestions",
  tokenStats: "TokenStats",
  undoRedo: "UndoRedo",
  checklist: "Checklist",
  approval: "Approval",
};

export const DRAGGABLE_PANEL_IDS = Object.keys(
  PUCK_PANEL_TYPE,
) as DraggablePanelId[];

export const LAYOUT_CONTAINER_TYPES = ["LayoutRow", "LayoutColumn"] as const;
