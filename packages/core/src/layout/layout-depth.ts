import type { ComponentData, Data } from "@puckeditor/core";
import { getZoneNodes } from "./puck-data.ts";
import type { LayoutZone } from "./types.ts";
import { LAYOUT_CONTAINER_TYPES } from "./types.ts";

export const MAX_LAYOUT_DEPTH = 4;

export function canInsertAtDepth(depth: number): boolean {
  return depth <= MAX_LAYOUT_DEPTH;
}

function isContainerType(type: string): boolean {
  return (LAYOUT_CONTAINER_TYPES as readonly string[]).includes(type);
}

/** Depth of a node within a zone tree (1 = direct child of zone slot). */
export function countNodeDepthInZone(
  data: Data,
  zone: LayoutZone,
  nodeId: string,
): number | null {
  const nodes = getZoneNodes(data, zone);
  return findDepth(nodes, nodeId, 1);
}

function findDepth(
  nodes: ComponentData[],
  nodeId: string,
  depth: number,
): number | null {
  for (const node of nodes) {
    if (node.props?.id === nodeId) return depth;
    const children = node.props?.children;
    if (Array.isArray(children)) {
      const childDepth = findDepth(children, nodeId, depth + 1);
      if (childDepth !== null) return childDepth;
    }
  }
  return null;
}

function treeContainsNodeId(
  nodes: ComponentData[],
  nodeId: string,
): boolean {
  return findDepth(nodes, nodeId, 1) !== null;
}

export function findNodeLayoutZone(
  data: Data,
  nodeId: string,
): LayoutZone | null {
  for (const zone of ["top", "bottom"] as const) {
    if (treeContainsNodeId(getZoneNodes(data, zone), nodeId)) {
      return zone;
    }
  }
  return null;
}

export function parseZoneCompound(zoneCompound: string): {
  parentId: string;
  slotName: string;
} {
  const idx = zoneCompound.indexOf(":");
  if (idx === -1) return { parentId: "root", slotName: zoneCompound };
  return {
    parentId: zoneCompound.slice(0, idx),
    slotName: zoneCompound.slice(idx + 1),
  };
}

export function layoutZoneFromDestination(
  data: Data,
  destinationZone: string,
): LayoutZone | null {
  const { parentId, slotName } = parseZoneCompound(destinationZone);
  if (parentId === "root" && (slotName === "top" || slotName === "bottom")) {
    return slotName;
  }
  return findNodeLayoutZone(data, parentId);
}

export function parentIdForDepth(parentId: string): string | null {
  return parentId === "root" ? "root" : parentId;
}

/** Depth if inserting as child of parentId (parent depth + 1). */
export function depthAfterInsert(
  data: Data,
  zone: LayoutZone,
  parentId: string | null,
): number {
  if (parentId === null || parentId === "root") return 1;
  const parentDepth = countNodeDepthInZone(data, zone, parentId);
  return parentDepth === null ? 1 : parentDepth + 1;
}

export function wouldExceedMaxDepth(
  data: Data,
  zone: LayoutZone,
  parentId: string | null,
  insertedType: string,
): boolean {
  const insertDepth = depthAfterInsert(data, zone, parentId);
  if (!canInsertAtDepth(insertDepth)) return true;
  if (!isContainerType(insertedType)) return false;
  return !canInsertAtDepth(insertDepth + 1);
}

export type PuckLayoutIndexes = {
  zones: Record<string, { contentIds: string[] }>;
  nodes: Record<string, { data: ComponentData }>;
};

export function getComponentTypeFromIndexes(
  indexes: PuckLayoutIndexes,
  zoneCompound: string,
  index: number,
): string | null {
  const zone = indexes.zones[zoneCompound];
  if (!zone || index < 0 || index >= zone.contentIds.length) return null;
  const nodeId = zone.contentIds[index];
  return indexes.nodes[nodeId]?.data?.type ?? null;
}

function findNodeById(data: Data, nodeId: string): ComponentData | null {
  for (const zone of ["top", "bottom"] as const) {
    const found = findNodeInTree(getZoneNodes(data, zone), nodeId);
    if (found) return found;
  }
  return null;
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

function getSlotContentFromProps(
  data: Data,
  zoneCompound: string,
): ComponentData[] | null {
  const { parentId, slotName } = parseZoneCompound(zoneCompound);
  if (parentId === "root" && (slotName === "top" || slotName === "bottom")) {
    return getZoneNodes(data, slotName);
  }
  const parent = findNodeById(data, parentId);
  if (!parent) return null;
  const children = parent.props?.children;
  return Array.isArray(children) ? children : null;
}

export function getComponentTypeInZone(
  data: Data,
  zoneCompound: string,
  index: number,
): string | null {
  const zones = (data as Data & { zones?: Record<string, ComponentData[]> })
    .zones;
  const zoned = zones?.[zoneCompound];
  if (Array.isArray(zoned) && index >= 0 && index < zoned.length) {
    return zoned[index]?.type ?? null;
  }

  const content = getSlotContentFromProps(data, zoneCompound);
  if (!Array.isArray(content) || index < 0 || index >= content.length) {
    return null;
  }
  return content[index]?.type ?? null;
}

export function containerAtMaxChildDepth(
  data: Data,
  nodeId: string,
): boolean {
  const zone = findNodeLayoutZone(data, nodeId);
  if (!zone) return false;
  const depth = countNodeDepthInZone(data, zone, nodeId);
  return depth !== null && depth >= MAX_LAYOUT_DEPTH;
}

