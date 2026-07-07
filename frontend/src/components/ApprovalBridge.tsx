import { useCallback, useMemo, useState } from "react";
import { useAuiState } from "@assistant-ui/store";
import { sendApproval } from "@/lib/bridge-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ApprovalOption = {
  optionId?: string;
  id?: string;
  name?: string;
  label?: string;
  kind?: string;
};

type ApprovalState = {
  pending?: boolean;
  callId?: string;
  toolName?: string;
  summary?: string;
  options?: ApprovalOption[];
};

type ApprovalBridgeProps = {
  threadId: string;
};

function optionId(option: ApprovalOption): string {
  return option.optionId ?? option.id ?? "allow_once";
}

function optionLabel(option: ApprovalOption): string {
  return option.name ?? option.label ?? optionId(option);
}

function isAllowKind(kind: string | undefined): boolean {
  return kind === "allow_once" || kind === "allow_always";
}

/**
 * Shows approval UI only when the agent emits STATE_DELTA via
 * ACP session/request_permission (bridge begin_permission_request).
 */
export function ApprovalBridge({ threadId }: ApprovalBridgeProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approval = useAuiState((s) => {
    const state = s.thread.state as { approval?: ApprovalState } | null | undefined;
    return state?.approval;
  });

  const pending = approval?.pending === true && !!approval.callId;
  const options = useMemo(() => approval?.options ?? [], [approval?.options]);

  const respond = useCallback(
    async (approved: boolean, selectedOptionId?: string) => {
      if (!approval?.callId) return;
      setSubmitting(true);
      setError(null);
      try {
        await sendApproval(
          threadId,
          approval.callId,
          approved,
          selectedOptionId,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Approval failed");
      } finally {
        setSubmitting(false);
      }
    },
    [approval?.callId, threadId],
  );

  const handleOption = useCallback(
    (option: ApprovalOption) => {
      const id = optionId(option);
      void respond(isAllowKind(option.kind), id);
    },
    [respond],
  );

  return (
    <Dialog open={pending} onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>需要审批工具调用</DialogTitle>
          <DialogDescription>
            {approval?.summary ??
              `Agent 请求执行工具：${approval?.toolName ?? "unknown"}`}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <DialogFooter className="flex flex-wrap gap-2 sm:justify-end">
          {options.length > 0 ? (
            options.map((option) => (
              <Button
                key={optionId(option)}
                type="button"
                variant={isAllowKind(option.kind) ? "default" : "destructive"}
                disabled={submitting}
                onClick={() => handleOption(option)}
              >
                {optionLabel(option)}
              </Button>
            ))
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => void respond(false, "reject_once")}
              >
                拒绝
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void respond(true, "allow_once")}
              >
                批准
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
