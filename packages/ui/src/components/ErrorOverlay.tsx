import { AlertTriangleIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@qenex/core";

type ErrorOverlayProps = {
  title: string;
  message: string;
  detail?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  testId?: string;
};

/** Floating error surface: never participates in the surrounding layout flow. */
export function ErrorOverlay({
  title,
  message,
  detail,
  actions,
  onDismiss,
  className,
  testId,
}: ErrorOverlayProps) {
  return (
    <aside
      role="alert"
      aria-live="assertive"
      data-testid={testId}
      className={cn(
        "pointer-events-auto absolute top-3 right-3 z-50 w-[min(26rem,calc(100%-1.5rem))] rounded-lg border border-destructive/25 bg-background/96 p-3 text-sm shadow-xl backdrop-blur-md",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangleIcon
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-1 max-h-28 overflow-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {message}
          </p>
          {detail ? (
            <div className="mt-1.5 text-[11px] text-muted-foreground/75">
              {detail}
            </div>
          ) : null}
          {actions ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
        {onDismiss ? (
          <button
            type="button"
            aria-label="关闭错误提示"
            className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onDismiss}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
    </aside>
  );
}
