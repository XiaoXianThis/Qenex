"use client";

import {
  memo,
  type FC,
  type PropsWithChildren,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CollapsiblePartTrigger } from "@/components/assistant-ui/collapsible-part-trigger";
import { useAutoCollapsibleOpen } from "@/components/assistant-ui/use-auto-collapsible-open";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@qenex/core";

const ANIMATION_DURATION = 200;

const toolGroupVariants = cva("aui-tool-group-root group/tool-group mb-1 w-full", {
  variants: {
    variant: {
      outline: "rounded-lg border py-2",
      ghost: "",
      muted: "border-muted-foreground/30 bg-muted/30 rounded-lg border py-2",
    },
  },
  defaultVariants: { variant: "ghost" },
});

export type ToolGroupRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> &
  VariantProps<typeof toolGroupVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  /**
   * 组内 tool 仍在跑时仅用于 Trigger shimmer；默认不自动展开（贴 Cursor）。
   */
  autoOpen?: boolean;
};

function ToolGroupRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  autoOpen = false,
  children,
  ...props
}: ToolGroupRootProps) {
  const { collapsibleRef, isOpen, handleOpenChange } = useAutoCollapsibleOpen({
    autoOpen,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    defaultOpen,
    animationDurationMs: ANIMATION_DURATION,
  });

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-group-root"
      data-variant={variant ?? "ghost"}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        toolGroupVariants({ variant }),
        "group/tool-group-root",
        className,
      )}
      style={
        {
          "--animation-duration": `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  );
}

function ToolGroupTrigger({
  count,
  active = false,
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsiblePartTrigger>,
  "label" | "active"
> & {
  count: number;
  active?: boolean;
}) {
  const label = active
    ? `Running ${count} tool ${count === 1 ? "call" : "calls"}`
    : `${count} tool ${count === 1 ? "call" : "calls"}`;

  return (
    <CollapsiblePartTrigger
      data-slot="tool-group-trigger"
      className={cn("aui-tool-group-trigger", className)}
      label={label}
      active={active}
      {...props}
    />
  );
}

function ToolGroupContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-group-content"
      className={cn(
        "aui-tool-group-content relative overflow-hidden text-sm outline-none",
        "group/collapsible-content ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
        "data-[state=closed]:animate-collapsible-up",
        "data-[state=open]:animate-collapsible-down",
        "data-[state=closed]:fill-mode-forwards",
        "data-[state=closed]:pointer-events-none",
        "data-[state=open]:duration-(--animation-duration)",
        "data-[state=closed]:duration-(--animation-duration)",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "mt-1 flex flex-col gap-1",
          "group-data-[variant=outline]/tool-group-root:mt-2 group-data-[variant=outline]/tool-group-root:border-t group-data-[variant=outline]/tool-group-root:px-3 group-data-[variant=outline]/tool-group-root:pt-2",
          "group-data-[variant=muted]/tool-group-root:mt-2 group-data-[variant=muted]/tool-group-root:border-t group-data-[variant=muted]/tool-group-root:px-3 group-data-[variant=muted]/tool-group-root:pt-2",
          "[&>*]:animate-in [&>*]:fade-in-0 [&>*]:slide-in-from-top-1 [&>*]:duration-(--animation-duration) [&>*]:ease-[cubic-bezier(0.32,0.72,0,1)]",
          "[&>*]:motion-reduce:animate-none",
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

type ToolGroupComponent = FC<
  PropsWithChildren<{ startIndex: number; endIndex: number }>
> & {
  Root: typeof ToolGroupRoot;
  Trigger: typeof ToolGroupTrigger;
  Content: typeof ToolGroupContent;
};

const ToolGroupImpl: FC<
  PropsWithChildren<{ startIndex: number; endIndex: number }>
> = ({ children, startIndex, endIndex }) => {
  const toolCount = endIndex - startIndex + 1;

  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={toolCount} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

/**
 * @deprecated This wrapper targets the legacy `components.ToolGroup` prop
 * on `<MessagePrimitive.Parts>`. Use `<MessagePrimitive.GroupedParts>` with
 * a `groupBy` returning `"group-tool"` and compose `ToolGroupRoot` /
 * `ToolGroupTrigger` / `ToolGroupContent` directly. See `thread.tsx`.
 */
const ToolGroup = memo(ToolGroupImpl) as unknown as ToolGroupComponent;

ToolGroup.displayName = "ToolGroup";
ToolGroup.Root = ToolGroupRoot;
ToolGroup.Trigger = ToolGroupTrigger;
ToolGroup.Content = ToolGroupContent;

export {
  ToolGroup,
  ToolGroupRoot,
  ToolGroupTrigger,
  ToolGroupContent,
  toolGroupVariants,
};
