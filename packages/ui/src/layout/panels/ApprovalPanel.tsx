"use client";

import {
  approvalOptionFullLabel,
  approvalOptionId,
  displayApprovalOptionLabel,
  getPendingApproval,
  isApprovalAllowKind,
  sendApproval,
  useApprovalPrefsStore,
  useTabsStore,
  useTaskApproval,
  approvalActions,
  type ApprovalState,
} from "@qenex/core";
import { ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState, type FC } from "react";
import { Button } from "@/components/ui/button";

export type ApprovalOption = {
  optionId?: string;
  id?: string;
  name?: string;
  label?: string;
  kind?: string;
};

export type { ApprovalState };

export function optionId(option: ApprovalOption): string {
  return approvalOptionId(option);
}

export function optionLabel(option: ApprovalOption): string {
  return approvalOptionFullLabel(option);
}

export function displayOptionLabel(option: ApprovalOption): string {
  return displayApprovalOptionLabel(option);
}

export function isAllowKind(kind: string | undefined): boolean {
  return isApprovalAllowKind(kind);
}

type ApprovalPanelBodyProps = {
  threadId: string;
  approval: ApprovalState;
};

export const ApprovalPanelBody: FC<ApprovalPanelBodyProps> = ({
  threadId,
  approval,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () => (approval.options ?? []) as ApprovalOption[],
    [approval.options],
  );
  const pendingCount = approval.pendingCount ?? 1;

  const respond = useCallback(
    async (approved: boolean, selectedOptionId?: string) => {
      if (!approval.callId) return;
      setSubmitting(true);
      setError(null);
      try {
        await sendApproval(threadId, approval.callId, approved, selectedOptionId);
        const next = await getPendingApproval(threadId);
        approvalActions.set(threadId, next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Approval failed");
      } finally {
        setSubmitting(false);
      }
    },
    [approval.callId, threadId],
  );

  const handleOption = useCallback(
    (option: ApprovalOption) => {
      void respond(isAllowKind(option.kind), optionId(option));
    },
    [respond],
  );

  const summary =
    approval.summary ??
    (approval.toolName
      ? `请求执行：${approval.toolName}`
      : "需要审批工具调用");

  return (
    <div className="border-border/60 bg-muted/10 flex min-w-0 flex-col gap-2 rounded-(--composer-radius) border px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <ShieldCheck className="text-amber-600 dark:text-amber-400 mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">
              {approval.toolName ?? "工具审批"}
            </span>
            {approval.category ? (
              <span className="text-muted-foreground text-xs">
                {approval.category}
              </span>
            ) : null}
            {pendingCount > 1 ? (
              <span className="bg-amber-500/15 text-amber-700 dark:text-amber-300 rounded-full px-1.5 py-0.5 text-xs">
                还有 {pendingCount} 条
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">
            {summary}
          </p>
        </div>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      <div className="flex w-full min-w-0 flex-wrap justify-end gap-1.5">
        {options.length > 0 ? (
          options.map((option) => {
            const full = optionLabel(option);
            const label = displayOptionLabel(option);
            return (
              <Button
                key={optionId(option)}
                type="button"
                variant={isAllowKind(option.kind) ? "default" : "outline"}
                size="sm"
                disabled={submitting}
                title={full}
                className="h-8 max-w-[10rem] min-w-0 shrink overflow-hidden rounded-full"
                onClick={() => handleOption(option)}
              >
                <span className="block max-w-full truncate">{label}</span>
              </Button>
            );
          })
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting}
              className="h-8 max-w-[10rem] min-w-0 shrink overflow-hidden rounded-full"
              onClick={() => void respond(false, "reject_once")}
            >
              拒绝
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              className="h-8 max-w-[10rem] min-w-0 shrink overflow-hidden rounded-full"
              onClick={() => void respond(true, "allow_once")}
            >
              允许一次
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export const ApprovalPanel: FC = () => {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const threadId = activeTab?.taskId;
  const approval = useTaskApproval(threadId);
  const autoAllow = useApprovalPrefsStore((s) => s.autoAllow);

  if (autoAllow || !threadId || !approval?.pending || !approval.callId) {
    return null;
  }

  return <ApprovalPanelBody threadId={threadId} approval={approval} />;
};
