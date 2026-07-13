import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";

export type ChangesStoreState = {
  /** Bumped to trigger ChangesPanel refresh for a task. */
  refreshNonce: Record<string, number>;
};

export const changesStore = proxy<ChangesStoreState>({
  refreshNonce: {},
});

export const changesActions = {
  bump(taskId: string) {
    if (!taskId) return;
    changesStore.refreshNonce[taskId] =
      (changesStore.refreshNonce[taskId] ?? 0) + 1;
  },

  /** Run finished may race git turn commit — bump now and once more shortly after. */
  bumpAfterRun(taskId: string) {
    this.bump(taskId);
    if (typeof window === "undefined") return;
    window.setTimeout(() => this.bump(taskId), 350);
  },
};

export function useChangesRefreshNonce(taskId: string | undefined): number {
  const snap = useSnapshot(changesStore);
  if (!taskId) return 0;
  return snap.refreshNonce[taskId] ?? 0;
}
