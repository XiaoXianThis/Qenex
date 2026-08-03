import type { ComponentData } from "@puckeditor/core";
import { getPresetState } from "./presets.ts";
import { migrateLayoutToV3 } from "./migrate-v2.ts";
import { migrateLayoutToV4 } from "./migrate-v3.ts";
import type { LayoutPersistedState, PanelId } from "./types.ts";
import {
  columnOfPanels,
  getZoneNodes,
  panelToComponentData,
  type PuckRootProps,
} from "./puck-data.ts";
import { PUCK_PANEL_TYPE } from "./types.ts";
import type { DraggablePanelId } from "./types.ts";

type LayoutV1ModuleState = {
  visible: boolean;
  slot: "top" | "center" | "bottom";
};

type LayoutV1State = {
  preset?: string;
  modules?: Record<string, LayoutV1ModuleState>;
  threadFooterOrder?: PanelId[];
};

function isV1State(value: unknown): value is LayoutV1State {
  if (!value || typeof value !== "object") return false;
  const v = value as LayoutV1State;
  return v.modules !== undefined && !("schemaVersion" in value);
}

export function migrateLayoutState(value: unknown): LayoutPersistedState {
  if (!value || typeof value !== "object") {
    return getPresetState("classic");
  }

  if (isV1State(value)) {
    const preset = value.preset;
    const basePreset =
      preset === "classic" ||
      preset === "composerTop" ||
      preset === "tabsBottom" ||
      preset === "minimal" ||
      preset === "workspace"
        ? preset
        : "classic";
    return stripUndoRedoPanel(applyV1Overrides(getPresetState(basePreset), value));
  }

  if (
    "schemaVersion" in value &&
    (value as { schemaVersion: number }).schemaVersion === 3
  ) {
    return stripUndoRedoPanel(migrateLayoutToV4(value));
  }

  if (
    "schemaVersion" in value &&
    (value as { schemaVersion: number }).schemaVersion === 4
  ) {
    return stripUndoRedoPanel(value as LayoutPersistedState);
  }

  const v3 = migrateLayoutToV3(value);
  return stripUndoRedoPanel(migrateLayoutToV4(v3));
}

function rootProps(state: LayoutPersistedState): PuckRootProps {
  return state.puckData.root.props as PuckRootProps;
}

/**
 * M8: remove legacy Git checkpoint / Changes (`undoRedo`) panels from persisted layouts.
 * Kept export alias `ensureUndoRedoPanel` for older imports.
 */
export function stripUndoRedoPanel(
  state: LayoutPersistedState,
): LayoutPersistedState {
  const next = structuredClone(state);
  removePanelFromPuckData(next, "undoRedo");
  if (next.panels.undoRedo) {
    next.panels.undoRedo = { visible: false, widthScope: "content" };
  }
  return next;
}

/** @deprecated Use stripUndoRedoPanel — name retained for migration call sites. */
export function ensureUndoRedoPanel(
  state: LayoutPersistedState,
): LayoutPersistedState {
  return stripUndoRedoPanel(state);
}

function applyV1Overrides(
  base: LayoutPersistedState,
  v1: LayoutV1State,
): LayoutPersistedState {
  const next = structuredClone(base);
  next.preset = "custom";

  if (!v1.modules) return next;

  for (const [id, mod] of Object.entries(v1.modules)) {
    const panelId = id as PanelId;
    if (next.panels[panelId]) {
      next.panels[panelId].visible = mod.visible;
    }
  }

  const tabBar = v1.modules.tabBar;
  if (tabBar) {
    const props = rootProps(next);
    props.top =
      tabBar.slot === "bottom"
        ? []
        : structuredClone(rootProps(getPresetState("classic")).top);
    props.bottom =
      tabBar.slot === "bottom" && tabBar.visible
        ? structuredClone(rootProps(getPresetState("tabsBottom")).bottom)
        : props.bottom;
    if (tabBar.slot !== "bottom" && !tabBar.visible) {
      props.top = [];
    }
  }

  const composer = v1.modules.composer;
  if (composer) {
    removePanelFromPuckData(next, "composer");
    if (composer.visible) {
      if (composer.slot === "top") {
        rootProps(next).top = structuredClone(
          rootProps(getPresetState("composerTop")).top,
        );
      } else {
        const footerOrder = (v1.threadFooterOrder ?? [
          "followupSuggestions",
          "scrollToBottom",
          "welcomeSuggestions",
        ]).filter((p) => v1.modules?.[p]?.visible !== false) as DraggablePanelId[];
        const cellPanels: DraggablePanelId[] = [...footerOrder, "composer"];
        const bottom = getZoneNodes(next.puckData, "bottom");
        if (bottom.length > 0) {
          const col = structuredClone(bottom[0]!);
          if (col.type === "LayoutColumn" && Array.isArray(col.props?.children)) {
            col.props.children = cellPanels.map((p) => panelToComponentData(p));
          }
          rootProps(next).bottom = [col, ...bottom.slice(1)];
        } else {
          rootProps(next).bottom = [columnOfPanels(cellPanels)];
        }
      }
    }
  }

  return next;
}

function removePanelFromPuckData(state: LayoutPersistedState, panelId: PanelId) {
  const puckType = PUCK_PANEL_TYPE[panelId as keyof typeof PUCK_PANEL_TYPE];
  if (!puckType) return;

  for (const zone of ["top", "bottom"] as const) {
    const nodes = getZoneNodes(state.puckData, zone);
    rootProps(state)[zone] = filterTypeFromTree(nodes, puckType);
  }
}

function filterTypeFromTree(
  nodes: ComponentData[],
  puckType: string,
): ComponentData[] {
  return nodes
    .map((node) => {
      if (node.type === puckType) return null;
      const children = node.props?.children;
      if (!Array.isArray(children)) return node;
      const nextChildren = filterTypeFromTree(children, puckType);
      if (nextChildren.length === 0 && (node.type === "LayoutRow" || node.type === "LayoutColumn")) {
        return null;
      }
      return {
        ...node,
        props: { ...node.props, children: nextChildren },
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);
}

export { migrateLayoutToV3 } from "./migrate-v2.ts";
export { migrateLayoutToV4 } from "./migrate-v3.ts";
