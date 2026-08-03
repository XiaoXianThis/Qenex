import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import type { BridgePendingApproval } from "../lib/aisdk-session.ts";

/**
 * M2: pending ACP permissions from Bun Bridge REST poll
 * (`GET /api/sessions/:id/approvals`), keyed by Bridge sessionId.
 */
export type ApprovalStoreState = {
  bySessionId: Record<string, BridgePendingApproval[] | undefined>;
};

/**
 * @deprecated AG-UI /v2 approval shape — only for legacy bridge-api typings.
 * M2 UI uses BridgePendingApproval.
 */
export type ApprovalState = {
  pending?: boolean;
  callId?: string;
  approvalId?: string;
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

export const approvalStore = proxy<ApprovalStoreState>({
  bySessionId: {},
});

function toPlainList(value: unknown): BridgePendingApproval[] {
  if (!Array.isArray(value)) return [];
  try {
    return JSON.parse(JSON.stringify(value)) as BridgePendingApproval[];
  } catch {
    return [];
  }
}

export const approvalActions = {
  replace(sessionId: string, approvals: BridgePendingApproval[] | unknown) {
    if (!sessionId) return;
    const list = toPlainList(approvals).filter(
      (item) => item && typeof item.approvalId === "string",
    );
    if (list.length === 0) {
      delete approvalStore.bySessionId[sessionId];
      return;
    }
    approvalStore.bySessionId[sessionId] = list;
  },

  /** Optimistic remove after a successful decide. */
  remove(sessionId: string, approvalId: string) {
    const current = approvalStore.bySessionId[sessionId];
    if (!current) return;
    const next = current.filter((item) => item.approvalId !== approvalId);
    if (next.length === 0) {
      delete approvalStore.bySessionId[sessionId];
      return;
    }
    approvalStore.bySessionId[sessionId] = next;
  },

  clear(sessionId: string) {
    delete approvalStore.bySessionId[sessionId];
  },
};

export function useSessionApprovals(
  sessionId: string | undefined,
): BridgePendingApproval[] {
  const snap = useSnapshot(approvalStore);
  if (!sessionId) return [];
  const value = snap.bySessionId[sessionId];
  if (!value) return [];
  return toPlainList(value);
}

/** First pending approval + remaining count (for the compact panel). */
export function usePrimaryApproval(sessionId: string | undefined): {
  approval: BridgePendingApproval | undefined;
  pendingCount: number;
} {
  const list = useSessionApprovals(sessionId);
  return {
    approval: list[0],
    pendingCount: list.length,
  };
}

/** @deprecated Use usePrimaryApproval. */
export function useTaskApproval(sessionId: string | undefined) {
  const { approval, pendingCount } = usePrimaryApproval(sessionId);
  if (!approval) return undefined;
  return {
    pending: true as const,
    approvalId: approval.approvalId,
    callId: approval.approvalId,
    toolName: approval.toolCall.title ?? approval.toolCall.kind ?? undefined,
    summary: summarizeApproval(approval),
    options: approval.options,
    pendingCount,
  };
}

export function summarizeApproval(approval: BridgePendingApproval): string {
  const paths =
    approval.toolCall.locations
      ?.map((loc) => loc.path)
      .filter((path): path is string => typeof path === "string" && !!path) ??
    [];
  if (paths.length > 0) {
    return paths.join("\n");
  }
  const input = approval.toolCall.rawInput;
  if (input == null) {
    return approval.toolCall.title || approval.toolCall.kind || "需要审批工具调用";
  }
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
