import type { ComponentData, Data } from "@puckeditor/core";
import { panelIdFromPuckType, getZoneNodes } from "./puck-data.ts";
import type { LayoutZone, PanelId, PanelMeta } from "./types.ts";
import { LAYOUT_CONTAINER_TYPES } from "./types.ts";

function isContainerType(type: string): boolean {
  return (LAYOUT_CONTAINER_TYPES as readonly string[]).includes(type);
}

/**
 * UI 里 renderPanel 恒返回 null 的面板（占位 / 已挪到别处），
 * 不计入行/列「是否有可见内容」。
 */
const LAYOUT_INERT_PANEL_IDS = new Set<PanelId>([
  "tokenStats",
  "checklist",
]);

export function isLayoutInertPanel(panelId: PanelId): boolean {
  return LAYOUT_INERT_PANEL_IDS.has(panelId);
}

/**
 * 节点（或其子树）是否包含至少一个布局上「有效可见」的面板。
 * 仅看 panels[id].visible，并排除 inert 面板。
 */
export function layoutNodeHasVisiblePanel(
  node: ComponentData,
  panels: Record<PanelId, PanelMeta>,
): boolean {
  const panelId = panelIdFromPuckType(node.type);
  if (panelId) {
    if (isLayoutInertPanel(panelId)) return false;
    return panels[panelId]?.visible !== false;
  }
  if (isContainerType(node.type)) {
    const children = node.props?.children;
    if (!Array.isArray(children) || children.length === 0) return false;
    return layoutNodesHaveVisiblePanel(children, panels);
  }
  return false;
}

export function layoutNodesHaveVisiblePanel(
  nodes: ComponentData[],
  panels: Record<PanelId, PanelMeta>,
): boolean {
  return nodes.some((node) => layoutNodeHasVisiblePanel(node, panels));
}

function findNodeInTree(
  nodes: ComponentData[],
  nodeId: string,
): ComponentData | null {
  for (const node of nodes) {
    if (node.props?.id === nodeId) return node;
    const children = node.props?.children;
    if (Array.isArray(children)) {
      const found = findNodeInTree(children, nodeId);
      if (found) return found;
    }
  }
  return null;
}

export function findLayoutNodeById(
  data: Data,
  nodeId: string,
): ComponentData | null {
  for (const zone of ["top", "bottom"] as const satisfies LayoutZone[]) {
    const found = findNodeInTree(getZoneNodes(data, zone), nodeId);
    if (found) return found;
  }
  return null;
}

/** 指定行/列实例在非编辑态是否应渲染（有可见后代面板） */
export function layoutContainerShouldRender(
  data: Data,
  containerId: string | undefined,
  panels: Record<PanelId, PanelMeta>,
  opts?: { editing?: boolean },
): boolean {
  if (opts?.editing) return true;
  if (!containerId) return true;
  const node = findLayoutNodeById(data, containerId);
  if (!node) return true;
  return layoutNodeHasVisiblePanel(node, panels);
}
