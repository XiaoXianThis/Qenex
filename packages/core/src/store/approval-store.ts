import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";

/** ACP permission request shown in the approval panel (from STATE_DELTA / GET). */
export type ApprovalState = {
  pending?: boolean;
  callId?: string;
  toolName?: string;
  summary?: string;
  options?: Array<{
    optionId?: string;
    id?: string;
    name?: string;
    label?: string;
    kind?: string;
  }>;
  category?: string;
  pendingCount?: number;
  approved?: boolean;
};

export type ApprovalStoreState = {
  byTaskId: Record<string, ApprovalState | undefined>;
};

export const approvalStore = proxy<ApprovalStoreState>({
  byTaskId: {},
});

function isPending(approval: ApprovalState | undefined): boolean {
  return approval?.pending === true && !!approval.callId;
}

/**
 * Detach from AG-UI / snapshot proxies before storing.
 * Valtio deep-proxies assigned objects in place; sharing agent.state.approval
 * would make options a Proxy array and break AG-UI's structuredClone(state).
 */
export function toPlainApproval(value: unknown): ApprovalState | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as ApprovalState;
  } catch {
    return undefined;
  }
}

export const approvalActions = {
  set(taskId: string, approval: ApprovalState | undefined | unknown) {
    if (!taskId) return;
    const plain = toPlainApproval(approval);
    if (!plain || !isPending(plain)) {
      delete approvalStore.byTaskId[taskId];
      return;
    }
    approvalStore.byTaskId[taskId] = plain;
  },

  clear(taskId: string) {
    delete approvalStore.byTaskId[taskId];
  },
};

export function useTaskApproval(taskId: string | undefined): ApprovalState | undefined {
  const snap = useSnapshot(approvalStore);
  if (!taskId) return undefined;
  const value = snap.byTaskId[taskId];
  if (!value) return undefined;
  // Snapshot is readonly proxy — return a plain copy for safe UI use.
  return toPlainApproval(value);
}
