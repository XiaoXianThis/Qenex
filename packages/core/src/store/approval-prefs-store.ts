import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";

export const APPROVAL_PREFS_KEY = "agent-center-approval-prefs";

export type ApprovalPrefsState = {
  /**
   * When true, automatically approve every permission request.
   * Applies to all agents; optionId is picked per-request from that agent's options.
   */
  autoAllow: boolean;
};

export const approvalPrefsStore = proxy<ApprovalPrefsState>({
  autoAllow: false,
});

export const approvalPrefsActions = {
  setAutoAllow(value: boolean) {
    approvalPrefsStore.autoAllow = value;
  },

  toggleAutoAllow() {
    approvalPrefsStore.autoAllow = !approvalPrefsStore.autoAllow;
  },
};

export function useApprovalPrefsStore<T>(
  selector: (state: ApprovalPrefsState) => T,
): T {
  const snap = useSnapshot(approvalPrefsStore) as ApprovalPrefsState;
  return selector(snap);
}

export async function hydrateApprovalPrefsStore(): Promise<void> {
  await hydrateValtioStore(APPROVAL_PREFS_KEY, approvalPrefsStore, {
    merge: (persisted) => {
      if (!persisted || typeof persisted !== "object") {
        return {};
      }
      const record = persisted as Partial<ApprovalPrefsState>;
      if (typeof record.autoAllow === "boolean") {
        return { autoAllow: record.autoAllow };
      }
      return {};
    },
  });
}

let unsubscribeApprovalPrefsPersist: (() => void) | null = null;

export function startApprovalPrefsPersist(): () => void {
  unsubscribeApprovalPrefsPersist?.();
  unsubscribeApprovalPrefsPersist = subscribeValtioPersist(
    APPROVAL_PREFS_KEY,
    approvalPrefsStore,
    {
      partialize: (state) => ({
        autoAllow: state.autoAllow,
      }),
    },
  );
  return () => {
    unsubscribeApprovalPrefsPersist?.();
    unsubscribeApprovalPrefsPersist = null;
  };
}
