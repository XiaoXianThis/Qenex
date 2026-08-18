"use client";

import { useEffect } from "react";
import {
  approvalActions,
  findPanelZone,
  layoutActions,
  listPendingApprovals,
  pickAutoAllowOption,
  respondToApproval,
  useApprovalPrefsStore,
  useHost,
  useLayoutStore,
  usePrimaryApproval,
} from "@qenex/core";
import { ApprovalPanelBody } from "@/layout/panels/ApprovalPanel";
import { useChatHelpers } from "@/components/ChatHelpersContext";

export const APPROVAL_POLL_ACTIVE_MS = 350;
export const APPROVAL_POLL_IDLE_MS = 2000;

export function approvalPollIntervalMs(input: {
  isActive: boolean;
  autoAllow: boolean;
  hasPending: boolean;
  chatBusy: boolean;
}): number | null {
  // Auto-allow must keep draining background Ask cards or SSE hangs.
  if (!input.isActive) {
    return input.autoAllow ? APPROVAL_POLL_IDLE_MS : null;
  }
  if (input.hasPending || input.chatBusy) return APPROVAL_POLL_ACTIVE_MS;
  return APPROVAL_POLL_IDLE_MS;
}

type ApprovalPollBridgeProps = {
  sessionId: string;
  /** Inactive keepalive slots skip poll unless Auto-allow is on. */
  isActive?: boolean;
};

/**
 * M2: poll Bun Bridge pending approvals and drive ApprovalPanel / ephemeral layout.
 * Replaces deleted AG-UI ApprovalBridge (STATE_DELTA).
 *
 * Auto mode only affects *new* Bridge decisions; any pending Ask card must still
 * be visible (or auto-resolved) so the stream cannot hang invisibly.
 */
export function ApprovalPollBridge({
  sessionId,
  isActive = true,
}: ApprovalPollBridgeProps) {
  const host = useHost();
  const autoAllow = useApprovalPrefsStore((s) => s.autoAllow);
  const puckData = useLayoutStore((s) => s.puckData);
  const panelInLayout = findPanelZone(puckData, "approval") != null;
  const { approval, pendingCount } = usePrimaryApproval(sessionId);
  const pending = Boolean(approval);
  const chat = useChatHelpers();
  const chatBusy =
    chat?.status === "submitted" || chat?.status === "streaming";
  const intervalMs = approvalPollIntervalMs({
    isActive,
    autoAllow,
    hasPending: pending,
    chatBusy,
  });

  useEffect(() => {
    if (intervalMs == null) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const list = await listPendingApprovals(sessionId, host);
        if (!active) return;
        approvalActions.replace(sessionId, list);
      } catch {
        // Transient bridge blips — keep last known pending until next tick.
      }
      if (active) {
        timer = setTimeout(() => {
          void poll();
        }, intervalMs);
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [host, sessionId, intervalMs]);

  useEffect(() => {
    return () => {
      approvalActions.clear(sessionId);
    };
  }, [sessionId]);

  // Auto-resolve leftovers, including background tabs so SSE does not stall.
  useEffect(() => {
    if (!autoAllow || !approval) return;
    const picked = pickAutoAllowOption(approval.options);
    const optionId = picked.optionId;
    if (!optionId) return;
    let cancelled = false;
    void (async () => {
      try {
        await respondToApproval(sessionId, approval.approvalId, optionId, host);
        if (!cancelled) {
          approvalActions.remove(sessionId, approval.approvalId);
        }
      } catch {
        // Keep the card visible for manual retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoAllow, approval, host, sessionId]);

  useEffect(() => {
    if (!isActive) return;
    layoutActions.setPanelVisibleEphemeral("approval", pending && !autoAllow);
    return () => {
      layoutActions.setPanelVisibleEphemeral("approval", false);
    };
  }, [isActive, pending, autoAllow]);

  // Hide floating card only when Auto is actively draining it, or layout hosts it.
  if (!isActive || panelInLayout || autoAllow || !approval) {
    return null;
  }

  return (
    <div className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 fixed inset-x-0 bottom-0 z-50 border-t px-3 py-2 shadow-lg backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <ApprovalPanelBody
          sessionId={sessionId}
          approval={approval}
          pendingCount={pendingCount}
        />
      </div>
    </div>
  );
}
