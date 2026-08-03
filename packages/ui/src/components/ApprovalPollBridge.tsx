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

const POLL_MS = 350;

type ApprovalPollBridgeProps = {
  sessionId: string;
};

/**
 * M2: poll Bun Bridge pending approvals and drive ApprovalPanel / ephemeral layout.
 * Replaces deleted AG-UI ApprovalBridge (STATE_DELTA).
 *
 * Auto mode only affects *new* Bridge decisions; any pending Ask card must still
 * be visible (or auto-resolved) so the stream cannot hang invisibly.
 */
export function ApprovalPollBridge({ sessionId }: ApprovalPollBridgeProps) {
  const host = useHost();
  const autoAllow = useApprovalPrefsStore((s) => s.autoAllow);
  const puckData = useLayoutStore((s) => s.puckData);
  const panelInLayout = findPanelZone(puckData, "approval") != null;
  const { approval, pendingCount } = usePrimaryApproval(sessionId);
  const pending = Boolean(approval);

  useEffect(() => {
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
        }, POLL_MS);
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      approvalActions.clear(sessionId);
      layoutActions.setPanelVisibleEphemeral("approval", false);
    };
  }, [host, sessionId]);

  // Auto-resolve leftovers when user switched to Auto while a card was pending.
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
    layoutActions.setPanelVisibleEphemeral("approval", pending && !autoAllow);
  }, [pending, autoAllow]);

  // Hide floating card only when Auto is actively draining it, or layout hosts it.
  if (panelInLayout || autoAllow || !approval) {
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
