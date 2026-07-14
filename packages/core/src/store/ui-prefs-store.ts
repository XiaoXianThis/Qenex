import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";

export const UI_PREFS_KEY = "agent-center-ui-prefs";

export type UiPrefsState = {
  /**
   * When true: messages scroll under frosted chrome (bottom composer band and/or
   * top TabBar) instead of stopping at a solid bar.
   */
  composerOverlay: boolean;
};

export const uiPrefsStore = proxy<UiPrefsState>({
  composerOverlay: false,
});

export const uiPrefsActions = {
  setComposerOverlay(value: boolean) {
    uiPrefsStore.composerOverlay = value;
  },

  toggleComposerOverlay() {
    uiPrefsStore.composerOverlay = !uiPrefsStore.composerOverlay;
  },
};

export function useUiPrefsStore<T>(selector: (state: UiPrefsState) => T): T {
  const snap = useSnapshot(uiPrefsStore) as UiPrefsState;
  return selector(snap);
}

export async function hydrateUiPrefsStore(): Promise<void> {
  await hydrateValtioStore(UI_PREFS_KEY, uiPrefsStore, {
    merge: (persisted) => {
      if (!persisted || typeof persisted !== "object") {
        return {};
      }
      const record = persisted as Partial<UiPrefsState>;
      if (typeof record.composerOverlay === "boolean") {
        return { composerOverlay: record.composerOverlay };
      }
      return {};
    },
  });
}

let unsubscribeUiPrefsPersist: (() => void) | null = null;

export function startUiPrefsPersist(): () => void {
  unsubscribeUiPrefsPersist?.();
  unsubscribeUiPrefsPersist = subscribeValtioPersist(
    UI_PREFS_KEY,
    uiPrefsStore,
    {
      partialize: (state) => ({
        composerOverlay: state.composerOverlay,
      }),
    },
  );
  return () => {
    unsubscribeUiPrefsPersist?.();
    unsubscribeUiPrefsPersist = null;
  };
}
