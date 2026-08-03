"use client";

import {
  approvalOptionFullLabel,
  approvalOptionId,
  displayApprovalOptionLabel,
  formatBridgeError,
  isApprovalAllowKind,
  isApprovalAlwaysAllowKind,
  respondToApproval,
  summarizeApproval,
  useApprovalPrefsStore,
  usePrimaryApproval,
  useTabsStore,
  approvalActions,
  type BridgePendingApproval,
} from "@qenex/core";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import { Button } from "@/components/ui/button";

export type ApprovalOption = {
  optionId?: string;
  id?: string;
  name?: string;
  label?: string;
  kind?: string;
};

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
  sessionId: string;
  approval: BridgePendingApproval;
  pendingCount?: number;
};

export const ApprovalPanelBody: FC<ApprovalPanelBodyProps> = ({
  sessionId,
  approval,
  pendingCount = 1,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const options = useMemo(
    () => (approval.options ?? []) as ApprovalOption[],
    [approval.options],
  );

  useEffect(() => {
    setExpanded(false);
    setError(null);
  }, [approval.approvalId]);

  const respond = useCallback(
    async (selectedOptionId: string) => {
      if (!selectedOptionId) return;
      setSubmitting(true);
      setError(null);
      try {
        await respondToApproval(sessionId, approval.approvalId, selectedOptionId);
        approvalActions.remove(sessionId, approval.approvalId);
      } catch (err) {
        setError(formatBridgeError(err, "审批失败，请重试。"));
      } finally {
        setSubmitting(false);
      }
    },
    [approval.approvalId, sessionId],
  );

  const handleOption = useCallback(
    (option: ApprovalOption) => {
      void respond(optionId(option));
    },
    [respond],
  );

  const toolName =
    approval.toolCall.title || approval.toolCall.kind || undefined;
  const summary = summarizeApproval(approval);
  const title = toolName ? `审批 · ${toolName}` : "审批 · 待确认";

  return (
    <div
      data-testid="approval-card"
      className="border-border/60 bg-muted/10 [[data-composer-overlay]_&]:bg-background/55 [[data-composer-overlay]_&]:supports-backdrop-filter:bg-background/40 flex min-w-0 flex-col overflow-hidden rounded-(--composer-radius) border text-sm [[data-composer-overlay]_&]:backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="hover:bg-accent flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-full px-1 py-1 text-left"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          )}
          <ShieldCheck className="text-amber-600 dark:text-amber-400 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate text-xs font-medium">
            需要审批
            {toolName ? ` · ${toolName}` : ""}
          </span>
          {pendingCount > 1 ? (
            <span className="bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0 rounded-full px-1.5 py-0.5 text-xs">
              还有 {pendingCount} 条
            </span>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {options.length > 0 ? (
            <>
              {options
                .filter((option) => !isAllowKind(option.kind))
                .map((option) => {
                  const full = optionLabel(option);
                  const label = displayOptionLabel(option);
                  return (
                    <button
                      key={optionId(option)}
                      type="button"
                      disabled={submitting}
                      title={full}
                      className="hover:bg-accent max-w-[10rem] min-w-0 cursor-pointer truncate rounded-full px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => handleOption(option)}
                    >
                      {label}
                    </button>
                  );
                })}
              {options
                .filter((option) => isAllowKind(option.kind))
                .sort((a, b) => {
                  // 「不再询问」在左，「允许」在右
                  const aAlways = isApprovalAlwaysAllowKind(a.kind) ? 0 : 1;
                  const bAlways = isApprovalAlwaysAllowKind(b.kind) ? 0 : 1;
                  return aAlways - bAlways;
                })
                .map((option) => {
                  const full = optionLabel(option);
                  const label = displayOptionLabel(option);
                  return (
                    <Button
                      key={optionId(option)}
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={submitting}
                      title={full}
                      className="h-auto max-w-[10rem] min-w-0 shrink overflow-hidden rounded-full px-2.5 py-1 text-xs"
                      onClick={() => handleOption(option)}
                    >
                      <span className="block max-w-full truncate">{label}</span>
                    </Button>
                  );
                })}
            </>
          ) : (
            <span className="text-muted-foreground px-2 text-xs">
              无可选项
            </span>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-destructive px-3 pb-2 text-xs whitespace-pre-wrap">
          {error}
        </p>
      ) : null}

      {expanded ? (
        <div className="border-border/50 max-h-[min(50vh,360px)] min-h-0 overflow-y-auto border-t px-2 py-2">
          <p className="text-muted-foreground px-1 text-xs leading-relaxed whitespace-pre-wrap">
            {title}
            {"\n"}
            {summary}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export const ApprovalPanel: FC = () => {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const sessionId = activeTab?.sessionId;
  const { approval, pendingCount } = usePrimaryApproval(sessionId);
  const autoAllow = useApprovalPrefsStore((s) => s.autoAllow);

  if (autoAllow || !sessionId || !approval) {
    return null;
  }

  return (
    <ApprovalPanelBody
      sessionId={sessionId}
      approval={approval}
      pendingCount={pendingCount}
    />
  );
};
