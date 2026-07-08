import type { Data } from "@puckeditor/core";
import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import { migrateLayoutState } from "../layout/migrate-v1.ts";
import {
  cycleWidthScope,
  getPanelDefinition,
} from "../layout/panel-registry.ts";
import {
  CLASSIC_LAYOUT,
  getPresetState,
} from "../layout/presets.ts";
import {
  findPanelZone,
  isComposerInTop,
  isTabBarInBottom,
} from "../layout/puck-data.ts";
import type {
  LayoutPersistedState,
  LayoutPresetId,
  PanelId,
  WidthScope,
} from "../layout/types.ts";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";

export const LAYOUT_PERSIST_KEY = "agent-center-layout";

export type LayoutState = LayoutPersistedState & {
  editMode: boolean;
};

function cloneClassic(): LayoutPersistedState {
  return structuredClone(CLASSIC_LAYOUT);
}

export const layoutStore = proxy<LayoutState>({
  ...cloneClassic(),
  editMode: false,
});

export const layoutActions = {
  setEditMode(editMode: boolean) {
    layoutStore.editMode = editMode;
  },

  applyPreset(preset: Exclude<LayoutPresetId, "custom">) {
    const next = getPresetState(preset);
    Object.assign(layoutStore, { ...next, editMode: false });
  },

  resetToDefault() {
    const next = getPresetState("classic");
    Object.assign(layoutStore, { ...next, editMode: false });
  },

  setPanelVisible(id: PanelId, visible: boolean) {
    const def = getPanelDefinition(id);
    if (!def.hideable && !visible) return;
    layoutStore.preset = "custom";
    layoutStore.panels[id] = { ...layoutStore.panels[id], visible };
  },

  setPanelWidthScope(id: PanelId, widthScope: WidthScope) {
    const def = getPanelDefinition(id);
    if (!def.resizableWidthScope.includes(widthScope)) return;
    layoutStore.preset = "custom";
    layoutStore.panels[id] = { ...layoutStore.panels[id], widthScope };
  },

  cyclePanelWidthScope(id: PanelId) {
    const def = getPanelDefinition(id);
    const current = layoutStore.panels[id].widthScope;
    const next = cycleWidthScope(current, def.resizableWidthScope);
    layoutStore.preset = "custom";
    layoutStore.panels[id] = { ...layoutStore.panels[id], widthScope: next };
  },

  setPuckData(puckData: Data) {
    layoutStore.preset = "custom";
    layoutStore.puckData = structuredClone(puckData);
  },

  markCustom() {
    layoutStore.preset = "custom";
  },
};

export function useLayoutStore<T>(selector: (state: LayoutState) => T): T {
  const snap = useSnapshot(layoutStore) as LayoutState;
  return selector(snap);
}

export async function hydrateLayoutStore(): Promise<void> {
  await hydrateValtioStore(LAYOUT_PERSIST_KEY, layoutStore, {
    merge: (persisted, current) => {
      const migrated = migrateLayoutState(persisted);
      return { ...current, ...migrated, editMode: false };
    },
  });
}

let unsubscribeLayoutPersist: (() => void) | null = null;

export function startLayoutPersist(): () => void {
  unsubscribeLayoutPersist?.();
  unsubscribeLayoutPersist = subscribeValtioPersist(
    LAYOUT_PERSIST_KEY,
    layoutStore,
    {
      partialize: (state) => ({
        schemaVersion: state.schemaVersion,
        preset: state.preset,
        puckData: state.puckData,
        panels: state.panels,
      }),
    },
  );
  return () => {
    unsubscribeLayoutPersist?.();
    unsubscribeLayoutPersist = null;
  };
}

export function selectTabBarPosition(state: LayoutState): "top" | "bottom" {
  return isTabBarInBottom(state.puckData) ? "bottom" : "top";
}

export function selectComposerInTopBand(state: LayoutState): boolean {
  return isComposerInTop(state.puckData);
}

export function selectPanelZone(
  state: LayoutState,
  panelId: PanelId,
): "top" | "bottom" | null {
  return findPanelZone(state.puckData, panelId);
}
