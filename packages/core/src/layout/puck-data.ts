import type { ComponentData, Data } from "@puckeditor/core";
import type { DraggablePanelId, LayoutZone, PanelId } from "./types.ts";
import { PUCK_PANEL_TYPE } from "./types.ts";

export type PuckRootProps = {
  top: ComponentData[];
  bottom: ComponentData[];
};

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function resetPuckIdCounter(): void {
  idCounter = 0;
}

export function panelIdFromPuckType(type: string): PanelId | null {
  for (const [id, puckType] of Object.entries(PUCK_PANEL_TYPE)) {
    if (puckType === type) return id as PanelId;
  }
  return null;
}

export function panelToComponentData(panelId: DraggablePanelId): ComponentData {
  return {
    type: PUCK_PANEL_TYPE[panelId],
    props: { id: nextId(PUCK_PANEL_TYPE[panelId]) },
  };
}

export function panelsToComponentData(
  panelIds: DraggablePanelId[],
): ComponentData[] {
  return panelIds.map((id) => panelToComponentData(id));
}

export function createLayoutColumn(
  children: ComponentData[],
): ComponentData {
  return {
    type: "LayoutColumn",
    props: {
      id: nextId("LayoutColumn"),
      children,
    },
  };
}

export function createLayoutRow(children: ComponentData[]): ComponentData {
  return {
    type: "LayoutRow",
    props: {
      id: nextId("LayoutRow"),
      children,
    },
  };
}

/** Stack panels vertically in a single column. */
export function columnOfPanels(
  panelIds: DraggablePanelId[],
): ComponentData {
  return createLayoutColumn(panelsToComponentData(panelIds));
}

/** Place each panel group in its own column within a row. */
export function rowOfPanelColumns(
  columns: DraggablePanelId[][],
): ComponentData {
  return createLayoutRow(columns.map((col) => columnOfPanels(col)));
}

export function emptyPuckData(): Data {
  return buildPuckData({});
}

export function buildPuckData(slots: Partial<PuckRootProps>): Data {
  const props: PuckRootProps = {
    top: slots.top ?? [],
    bottom: slots.bottom ?? [],
  };
  return {
    content: [],
    root: { props: props as unknown as Data["root"]["props"] },
  };
}

export function getZoneNodes(data: Data, zone: LayoutZone): ComponentData[] {
  const props = data.root?.props as PuckRootProps | undefined;
  const nodes = props?.[zone];
  return Array.isArray(nodes) ? nodes : [];
}

export function findPanelZone(
  data: Data,
  panelId: PanelId,
): LayoutZone | null {
  const puckType = PUCK_PANEL_TYPE[panelId as keyof typeof PUCK_PANEL_TYPE];
  if (!puckType) return null;

  for (const zone of ["top", "bottom"] as const) {
    if (nodeTreeContainsType(getZoneNodes(data, zone), puckType)) {
      return zone;
    }
  }
  return null;
}

function nodeTreeContainsType(
  nodes: ComponentData[],
  puckType: string,
): boolean {
  for (const node of nodes) {
    if (node.type === puckType) return true;
    const children = node.props?.children;
    if (Array.isArray(children) && nodeTreeContainsType(children, puckType)) {
      return true;
    }
  }
  return false;
}

export function isTabBarInBottom(data: Data): boolean {
  return findPanelZone(data, "tabBar") === "bottom";
}

export function isComposerInTop(data: Data): boolean {
  return findPanelZone(data, "composer") === "top";
}
