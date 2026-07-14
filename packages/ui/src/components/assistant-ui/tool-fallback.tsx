"use client";

import { createContext, memo, useContext, useState } from "react";
import {
  useToolCallElapsed,
  type ToolApprovalOption,
  type ToolCallMessagePart,
  type ToolCallMessagePartProps,
  type ToolCallMessagePartStatus,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { CollapsiblePartTrigger } from "@/components/assistant-ui/collapsible-part-trigger";
import { useAutoCollapsibleOpen } from "@/components/assistant-ui/use-auto-collapsible-open";
import {
  ToolCallBody,
  ToolCallCardBody,
  ToolCallCardHeaderTrigger,
  ToolCardShell,
  buildToolCallModel,
} from "@/components/assistant-ui/tool-call-view";
import { shouldDefaultToolPreview } from "@/components/assistant-ui/tool-call-format";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  cn,
  displayApprovalOptionLabel,
  isApprovalAllowKind,
  useToolProgress,
} from "@qenex/core";
import { Button } from "@/components/ui/button";

const ANIMATION_DURATION = 200;

/** 预览态：最多约 5 行 */
const PREVIEW_MAX_H = "max-h-[5lh]";

const pressable = "cursor-pointer active:scale-[0.98]";

const ToolPreviewContext = createContext(false);

export type ToolFallbackRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /**
   * Shell / 写文件 / 编辑等：默认预览（约 5 行）；其余默认收起。
   * 组合用法可覆盖。
   */
  autoOpen?: boolean;
};

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  autoOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const { collapsibleRef, isOpen, isPreview, handleOpenChange } =
    useAutoCollapsibleOpen({
      autoOpen,
      open: controlledOpen,
      onOpenChange: controlledOnOpenChange,
      defaultOpen,
      animationDurationMs: ANIMATION_DURATION,
      previewClickExpands: autoOpen,
    });

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      data-preview={isPreview ? "true" : undefined}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "aui-tool-fallback-root group/tool-fallback-root mb-1 w-full",
        className,
      )}
      style={
        {
          "--animation-duration": `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      <ToolPreviewContext.Provider value={isPreview}>
        {children}
      </ToolPreviewContext.Provider>
    </Collapsible>
  );
}

function ToolPreviewFade() {
  return (
    <div
      data-slot="tool-preview-fade"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-[linear-gradient(to_top,var(--color-background),transparent)]"
      aria-hidden
    />
  );
}

const formatToolDuration = (ms: number) => {
  if (ms < 1000) return "<1s";
  const seconds = ms / 1000;
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
};

function ToolFallbackDuration({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const elapsedMs = useToolCallElapsed();
  if (elapsedMs === undefined) return null;

  return (
    <span
      data-slot="tool-fallback-duration"
      className={cn(
        "aui-tool-fallback-duration text-muted-foreground/80 text-xs tabular-nums",
        className,
      )}
      {...props}
    >
      {formatToolDuration(elapsedMs)}
    </span>
  );
}

function ToolFallbackTrigger({
  toolName,
  status,
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsiblePartTrigger>,
  "label" | "meta" | "active"
> & {
  toolName: string;
  status?: ToolCallMessagePartStatus;
}) {
  const statusType = status?.type ?? "complete";
  const isRunning = statusType === "running";
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";
  const isRequiresAction = statusType === "requires-action";

  const label = isCancelled
    ? `Cancelled ${toolName}`
    : isRequiresAction
      ? `Approve ${toolName}`
      : toolName;

  return (
    <CollapsiblePartTrigger
      data-slot="tool-fallback-trigger"
      className={cn(
        "aui-tool-fallback-trigger",
        isCancelled && "line-through opacity-70",
        className,
      )}
      label={label}
      meta={!isRunning && !isRequiresAction ? <ToolFallbackDuration /> : undefined}
      active={isRunning || isRequiresAction}
      {...props}
    />
  );
}

function ToolFallbackContent({
  className,
  children,
  compact = false,
  ...props
}: React.ComponentProps<typeof CollapsibleContent> & {
  /** 卡片内嵌：去掉外围 padding */
  compact?: boolean;
}) {
  const isPreview = useContext(ToolPreviewContext);

  return (
    <CollapsibleContent
      data-slot="tool-fallback-content"
      className={cn(
        "aui-tool-fallback-content relative overflow-hidden text-sm outline-none",
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
          "relative",
          "ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
          "group-data-[state=open]/collapsible-content:animate-in group-data-[state=open]/collapsible-content:fade-in-0 group-data-[state=open]/collapsible-content:slide-in-from-top-1",
          "group-data-[state=closed]/collapsible-content:animate-out group-data-[state=closed]/collapsible-content:fade-out-0 group-data-[state=closed]/collapsible-content:slide-out-to-top-1",
          "group-data-[state=closed]/collapsible-content:duration-(--animation-duration) group-data-[state=open]/collapsible-content:duration-(--animation-duration)",
          compact ? "" : "flex flex-col gap-2 ps-0.5 pt-1 pb-2",
          isPreview && cn(PREVIEW_MAX_H, "overflow-hidden"),
        )}
      >
        {children}
        {isPreview ? <ToolPreviewFade /> : null}
      </div>
    </CollapsibleContent>
  );
}

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  argsText?: string;
}) {
  if (!argsText) return null;

  return (
    <div
      data-slot="tool-fallback-args"
      className={cn("aui-tool-fallback-args", className)}
      {...props}
    >
      <ToolCallBody toolName="" argsText={argsText} />
    </div>
  );
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  result?: unknown;
}) {
  if (result === undefined) return null;

  return (
    <div
      data-slot="tool-fallback-result"
      className={cn("aui-tool-fallback-result", className)}
      {...props}
    >
      <ToolCallBody toolName="" result={result} />
    </div>
  );
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  status?: ToolCallMessagePartStatus;
}) {
  if (status?.type !== "incomplete") return null;

  const error = status.error;
  const errorText = error
    ? typeof error === "string"
      ? error
      : JSON.stringify(error)
    : null;

  if (!errorText) return null;

  const isCancelled = status.reason === "cancelled";
  const headerText = isCancelled ? "Cancelled reason:" : "Error:";

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn("aui-tool-fallback-error", className)}
      {...props}
    >
      <p className="aui-tool-fallback-error-header text-muted-foreground font-semibold">
        {headerText}
      </p>
      <p className="aui-tool-fallback-error-reason text-muted-foreground">
        {errorText}
      </p>
    </div>
  );
}

const APPROVED_RESULT = "Approved by user";
const DENIED_RESULT = "User denied tool execution";

const KNOWN_APPROVAL_KINDS = new Set([
  "allow-once",
  "allow_once",
  "allow-always",
  "allow_always",
  "reject-once",
  "reject_once",
  "reject-always",
  "reject_always",
]);

const isAllowKind = (kind: string) => isApprovalAllowKind(kind);

const approvalOptionLabel = (option: ToolApprovalOption) =>
  displayApprovalOptionLabel({
    id: option.id,
    label: option.label,
    kind: option.kind,
  });

/**
 * 行内审批（组合 API）。主路径已改为全局 ApprovalPanel / ApprovalBridge，
 * ToolFallback 默认不再挂载本组件。
 */
function ToolFallbackApproval({
  className,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
  ...props
}: React.ComponentProps<"div"> &
  Partial<
    Pick<ToolCallMessagePartProps, "addResult" | "resume" | "respondToApproval">
  > & {
    interrupt?: ToolCallMessagePart["interrupt"];
    approval?: ToolCallMessagePart["approval"];
  }) {
  const [submitted, setSubmitted] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (
    approval != null &&
    (approval.approved !== undefined || approval.resolution !== undefined)
  )
    return null;

  const declaredOptions = respondToApproval ? approval?.options : undefined;
  const options = declaredOptions?.filter((o) =>
    KNOWN_APPROVAL_KINDS.has(o.kind),
  );

  const respond = (approved: boolean) => {
    if (submitted) return;
    if (
      approval != null &&
      approval.approved === undefined &&
      respondToApproval
    ) {
      respondToApproval({ approved });
    } else if (interrupt) {
      resume?.({ approved });
    } else {
      addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT);
    }
    setSubmitted(true);
  };

  const respondWithOption = (option: ToolApprovalOption) => {
    if (submitted) return;
    respondToApproval?.({ optionId: option.id });
    setSubmitted(true);
    setConfirmingId(null);
  };

  const handleOption = (option: ToolApprovalOption) => {
    if (option.confirm) {
      setConfirmingId(option.id);
    } else {
      respondWithOption(option);
    }
  };

  const confirming =
    confirmingId != null
      ? options?.find((o) => o.id === confirmingId)
      : undefined;

  if (confirming) {
    const confirmMeta =
      typeof confirming.confirm === "object" ? confirming.confirm : undefined;
    const confirmDescription =
      confirmMeta?.description ?? confirming.description;
    return (
      <div
        data-slot="tool-fallback-approval-confirm"
        className={cn(
          "aui-tool-fallback-approval-confirm flex flex-col gap-2 pt-1",
          className,
        )}
        {...props}
      >
        <p className="aui-tool-fallback-approval-confirm-title font-semibold">
          {confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}
        </p>
        {confirmDescription && (
          <p className="aui-tool-fallback-approval-confirm-description text-muted-foreground">
            {confirmDescription}
          </p>
        )}
        {confirming.grants && confirming.grants.length > 0 && (
          <ul className="aui-tool-fallback-approval-confirm-grants flex flex-col gap-1">
            {confirming.grants.map((grant) => (
              <li key={grant}>
                <code className="aui-tool-fallback-approval-confirm-grant bg-muted rounded px-1.5 py-0.5 text-xs">
                  {grant}
                </code>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className={pressable}
            onClick={() => respondWithOption(confirming)}
            disabled={submitted}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={pressable}
            onClick={() => setConfirmingId(null)}
            disabled={submitted}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (declaredOptions && declaredOptions.length > 0) {
    const allowOptions = options?.filter((o) => isAllowKind(o.kind)) ?? [];
    const rejectOptions = options?.filter((o) => !isAllowKind(o.kind)) ?? [];
    return (
      <div
        data-slot="tool-fallback-approval"
        className={cn(
          "aui-tool-fallback-approval flex flex-wrap items-center gap-2 pt-1",
          className,
        )}
        {...props}
      >
        {[...allowOptions, ...rejectOptions].map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option === allowOptions[0] ? "default" : "outline"}
            className={pressable}
            onClick={() => handleOption(option)}
            disabled={submitted}
          >
            {approvalOptionLabel(option)}
          </Button>
        ))}
        {rejectOptions.length === 0 && (
          <Button
            size="sm"
            variant="outline"
            className={pressable}
            onClick={() => respond(false)}
            disabled={submitted}
          >
            拒绝
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      data-slot="tool-fallback-approval"
      className={cn(
        "aui-tool-fallback-approval flex items-center gap-2 pt-1",
        className,
      )}
      {...props}
    >
      <Button
        size="sm"
        className={pressable}
        onClick={() => respond(true)}
        disabled={submitted}
      >
        允许一次
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={pressable}
        onClick={() => respond(false)}
        disabled={submitted}
      >
        拒绝
      </Button>
    </div>
  );
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  toolCallId,
  argsText,
  result,
  status,
}) => {
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";
  const isRunning = status?.type === "running";
  const isRequiresAction = status?.type === "requires-action";

  const liveProgress = useToolProgress(toolCallId);
  const model = buildToolCallModel(
    toolName,
    argsText,
    isCancelled ? undefined : result,
    isCancelled ? null : liveProgress,
  );
  const defaultPreview = shouldDefaultToolPreview(model.kind);
  const active = isRunning || isRequiresAction;

  // Shell / 写文件 / 编辑：默认预览 → 点击完全展开
  if (defaultPreview) {
    return (
      <ToolFallbackRoot
        autoOpen
        className={cn(isCancelled && "opacity-60")}
      >
        <ToolCardShell>
          <ToolCallCardHeaderTrigger model={model} active={active} />
          <ToolFallbackContent compact>
            <ToolFallbackError status={status} />
            {!model.empty ? <ToolCallCardBody model={model} /> : null}
          </ToolFallbackContent>
        </ToolCardShell>
      </ToolFallbackRoot>
    );
  }

  // Read / Grep / generic：默认收起 → 点击完全展开
  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={toolName} status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolCallBody
          toolName={toolName}
          argsText={argsText}
          result={isCancelled ? undefined : result}
          progressText={isCancelled ? null : liveProgress}
          className={cn(isCancelled && "opacity-60")}
        />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const ToolFallback = memo(
  ToolFallbackImpl,
) as unknown as ToolCallMessagePartComponent & {
  Root: typeof ToolFallbackRoot;
  Trigger: typeof ToolFallbackTrigger;
  Content: typeof ToolFallbackContent;
  Args: typeof ToolFallbackArgs;
  Result: typeof ToolFallbackResult;
  Error: typeof ToolFallbackError;
  Approval: typeof ToolFallbackApproval;
};

ToolFallback.displayName = "ToolFallback";
ToolFallback.Root = ToolFallbackRoot;
ToolFallback.Trigger = ToolFallbackTrigger;
ToolFallback.Content = ToolFallbackContent;
ToolFallback.Args = ToolFallbackArgs;
ToolFallback.Result = ToolFallbackResult;
ToolFallback.Error = ToolFallbackError;
ToolFallback.Approval = ToolFallbackApproval;

export {
  ToolFallback,
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
  ToolFallbackApproval,
};
