import type { Data } from "@puckeditor/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getHostPersistStorage } from "../lib/host-storage.ts";
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

type LayoutState = LayoutPersistedState & {
  editMode: boolean;
};

type LayoutActions = {
  setEditMode: (editMode: boolean) => void;
  applyPreset: (preset: Exclude<LayoutPresetId, "custom">) => void;
  resetToDefault: () => void;
  setPanelVisible: (id: PanelId, visible: boolean) => void;
  setPanelWidthScope: (id: PanelId, widthScope: WidthScope) => void;
  cyclePanelWidthScope: (id: PanelId) => void;
  setPuckData: (puckData: Data) => void;
  markCustom: () => void;
};

function cloneClassic(): LayoutPersistedState {
  return structuredClone(CLASSIC_LAYOUT);
}

export const useLayoutStore = create<LayoutState & LayoutActions>()(
  persist(
    (set) => ({
      ...cloneClassic(),
      editMode: false,

      setEditMode: (editMode) => set({ editMode }),

      applyPreset: (preset) => {
        const next = getPresetState(preset);
        set({ ...next, editMode: false });
      },

      resetToDefault: () => {
        const next = getPresetState("classic");
        set({ ...next, editMode: false });
      },

      setPanelVisible: (id, visible) => {
        const def = getPanelDefinition(id);
        if (!def.hideable && !visible) return;
        set((state) => ({
          preset: "custom",
          panels: {
            ...state.panels,
            [id]: { ...state.panels[id], visible },
          },
        }));
      },

      setPanelWidthScope: (id, widthScope) => {
        const def = getPanelDefinition(id);
        if (!def.resizableWidthScope.includes(widthScope)) return;
        set((state) => ({
          preset: "custom",
          panels: {
            ...state.panels,
            [id]: { ...state.panels[id], widthScope },
          },
        }));
      },

      cyclePanelWidthScope: (id) => {
        set((state) => {
          const def = getPanelDefinition(id);
          const current = state.panels[id].widthScope;
          const next = cycleWidthScope(current, def.resizableWidthScope);
          return {
            preset: "custom" as const,
            panels: {
              ...state.panels,
              [id]: { ...state.panels[id], widthScope: next },
            },
          };
        });
      },

      setPuckData: (puckData) => {
        set({
          preset: "custom",
          puckData: structuredClone(puckData),
        });
      },

      markCustom: () => set({ preset: "custom" }),
    }),
    {
      name: "agent-center-layout",
      storage: createJSONStorage(() => getHostPersistStorage()),
      skipHydration: true,
      partialize: (state) => ({
        schemaVersion: state.schemaVersion,
        preset: state.preset,
        puckData: state.puckData,
        panels: state.panels,
      }),
      merge: (persisted, current) => {
        const migrated = migrateLayoutState(persisted);
        return { ...current, ...migrated, editMode: false };
      },
    },
  ),
);

type LayoutStoreSlice = LayoutPersistedState & { editMode: boolean };

export function selectTabBarPosition(
  state: LayoutStoreSlice,
): "top" | "bottom" {
  return isTabBarInBottom(state.puckData) ? "bottom" : "top";
}

export function selectComposerInTopBand(state: LayoutStoreSlice): boolean {
  return isComposerInTop(state.puckData);
}

export function selectPanelZone(
  state: LayoutStoreSlice,
  panelId: PanelId,
): "top" | "bottom" | null {
  return findPanelZone(state.puckData, panelId);
}
