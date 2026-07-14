"use client";

import type { ComponentProps, ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@qenex/core";

export type CollapsiblePartTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  /** 折叠头文案 */
  label: ReactNode;
  /** 进行中时对文案做高亮 swipe */
  active?: boolean;
  /** 文案旁次要信息（如耗时） */
  meta?: ReactNode;
};


/**
 * Cursor 风格折叠头：文字 + `>`，进行中文案高亮 swipe。
 * 供 Reasoning / ToolFallback / ToolGroup 共用。
 */
export function CollapsiblePartTrigger({
  label,
  active = false,
  meta,
  className,
  ...props
}: CollapsiblePartTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        "group/trigger text-muted-foreground hover:text-foreground flex max-w-[min(100%,28rem)] cursor-pointer origin-left items-center gap-1 py-1 text-sm transition-[color,scale] active:scale-[0.98]",
        className,
      )}
      {...props}
    >
      <span className="relative inline-block min-w-0 truncate leading-none">
        <span className="inline-flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{label}</span>
          {meta ? (
            <span className="text-muted-foreground/80 shrink-0 text-xs tabular-nums">
              {meta}
            </span>
          ) : null}
        </span>
        {active ? (
          <span
            aria-hidden
            className="shimmer text-foreground pointer-events-none absolute inset-0 inline-flex min-w-0 items-baseline gap-1.5 motion-reduce:animate-none"
          >
            <span className="truncate">{label}</span>
            {meta ? (
              <span className="shrink-0 text-xs tabular-nums">{meta}</span>
            ) : null}
          </span>
        ) : null}
      </span>
      <ChevronRightIcon
        aria-hidden
        className={cn(
          "mt-px size-3.5 shrink-0 opacity-70",
          "transition-transform duration-(--animation-duration,200ms) ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          "group-data-[state=closed]/trigger:rotate-0",
          "group-data-[state=open]/trigger:rotate-90",
        )}
      />
    </CollapsibleTrigger>
  );
}
