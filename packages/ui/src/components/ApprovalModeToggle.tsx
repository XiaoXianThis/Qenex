"use client";

import {
  approvalModeFromAutoAllow,
  approvalPrefsActions,
  cn,
  useApprovalPrefsStore,
  type ApprovalMode,
} from "@qenex/core";

type ApprovalModeToggleProps = {
  className?: string;
  disabled?: boolean;
};

/** Composer Ask | Auto switch → Bridge `approvalMode` via prefs. */
export function ApprovalModeToggle({
  className,
  disabled,
}: ApprovalModeToggleProps) {
  const autoAllow = useApprovalPrefsStore((s) => s.autoAllow);
  const mode: ApprovalMode = approvalModeFromAutoAllow(autoAllow);

  return (
    <div
      className={cn(
        "border-border/60 bg-muted/20 inline-flex items-center rounded-full border p-0.5",
        className,
      )}
      role="group"
      aria-label="审批模式"
    >
      {(["ask", "auto"] as const).map((value) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            className={cn(
              "cursor-pointer rounded-full px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() =>
              approvalPrefsActions.setAutoAllow(value === "auto")
            }
          >
            {value === "ask" ? "Ask" : "Auto"}
          </button>
        );
      })}
    </div>
  );
}
