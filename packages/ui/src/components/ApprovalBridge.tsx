import { useEffect, useRef } from "react";
import {
  approvalActions,
  findPanelZone,
  getPendingApproval,
  layoutActions,
  pickAutoAllowOption,
  sendApproval,
  useApprovalPrefsStore,
  useLayoutStore,
  useTaskApproval,
  type ApprovalState,
  type BridgeHttpAgent,
} from "@qenex/core";
import { useAuiState } from "@assistant-ui/store";
import { ApprovalPanelBody } from "@/layout/panels/ApprovalPanel";

type ApprovalBridgeProps = {
  threadId: string;
  agent: BridgeHttpAgent;
};

function applyApprovalDelta(taskId: string, delta: unknown): void {
  if (!Array.isArray(delta)) return;
  for (const op of delta) {
    if (!op || typeof op !== "object") continue;
    const patch = op as { op?: string; path?: string; value?: unknown };
    if (patch.path !== "/approval") continue;
    if (patch.op === "remove") {
      approvalActions.clear(taskId);
      continue;
    }
    if (patch.op === "add" || patch.op === "replace") {
      approvalActions.set(taskId, patch.value);
    }
  }
}

/**
 * Keeps approval store in sync with Bridge waiters + live STATE_DELTA.
 * History replay does not restore thread.state.approval, so we hydrate via GET.
 *
 * Important: never assign live AG-UI state objects into valtio — valtio
 * deep-proxies in place and breaks AG-UI structuredClone(state).
 */
export function ApprovalBridge({ threadId, agent }: ApprovalBridgeProps) {
  const approval = useTaskApproval(threadId);
  const pending = approval?.pending === true && !!approval.callId;
  const autoAllow = useApprovalPrefsStore((s) => s.autoAllow);
  const puckData = useLayoutStore((s) => s.puckData);
  const panelInLayout = findPanelZone(puckData, "approval") != null;
  const autoAllowInFlight = useRef<string | null>(null);

  const auiApproval = useAuiState((s) => {
    const state = s.thread.state as { approval?: ApprovalState } | null | undefined;
    return state?.approval;
  });

  useEffect(() => {
    let cancelled = false;
    void getPendingApproval(threadId)
      .then((state) => {
        if (!cancelled) approvalActions.set(threadId, state);
      })
      .catch(() => {
        if (!cancelled) approvalActions.clear(threadId);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (auiApproval) {
      approvalActions.set(threadId, auiApproval);
    }
  }, [auiApproval, threadId]);

  useEffect(() => {
    const subscription = agent.subscribe({
      onStateDeltaEvent: ({ event }) => {
        applyApprovalDelta(threadId, event.delta);
      },
      onStateChanged: ({ state }) => {
        const next = (state as { approval?: unknown } | null | undefined)?.approval;
        if (next) {
          approvalActions.set(threadId, next);
        }
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, threadId]);

  // Auto-allow: respond immediately for any agent, picking allow_always when offered.
  useEffect(() => {
    if (!autoAllow || !pending || !approval?.callId) {
      autoAllowInFlight.current = null;
      return;
    }
    const callId = approval.callId;
    if (autoAllowInFlight.current === callId) return;
    autoAllowInFlight.current = callId;

    const { optionId } = pickAutoAllowOption(approval.options);
    let cancelled = false;
    void (async () => {
      try {
        await sendApproval(threadId, callId, true, optionId);
        if (cancelled) return;
        const next = await getPendingApproval(threadId);
        if (!cancelled) approvalActions.set(threadId, next);
      } catch {
        if (!cancelled && autoAllowInFlight.current === callId) {
          autoAllowInFlight.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // options are fixed per callId — omit from deps to avoid cancel/retry churn
    // from useTaskApproval's plain-object copies each render.
  }, [autoAllow, pending, approval?.callId, threadId]);

  useEffect(() => {
    layoutActions.setPanelVisibleEphemeral("approval", pending && !autoAllow);
  }, [pending, autoAllow]);

  if (panelInLayout || autoAllow) {
    return null;
  }

  if (!pending || !approval) {
    return null;
  }

  return (
    <div className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t px-3 py-2 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <ApprovalPanelBody threadId={threadId} approval={approval} />
      </div>
    </div>
  );
}
