"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon, TerminalIcon } from "lucide-react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@qenex/core";
import {
  buildEditDiffLines,
  buildResultDiffLines,
  classifyTool,
  countDiffStats,
  fileBasename,
  fileExtLabel,
  formatResultText,
  genericArgEntries,
  hasMeaningfulArgs,
  parseToolArgs,
  pickCommand,
  pickContentPreview,
  pickGlob,
  pickPath,
  pickPathFromResult,
  pickPattern,
  unwrapAcpToolEnvelope,
  type DiffLine,
  type ToolArgs,
  type ToolViewKind,
} from "@/components/assistant-ui/tool-call-format";
import { ToolCodeBlock } from "@/components/assistant-ui/tool-code-block";

export type ToolCallModel = {
  kind: ToolViewKind;
  args: ToolArgs;
  output: string | null;
  empty: boolean;
  path?: string;
  command?: string;
  diffLines: DiffLine[];
  stats: { additions: number; deletions: number };
};

export function buildToolCallModel(
  toolName: string,
  argsText?: string,
  result?: unknown,
  progressText?: string | null,
): ToolCallModel {
  const parsed = parseToolArgs(argsText);
  const unwrapped = unwrapAcpToolEnvelope(parsed);
  const args = unwrapped.args;
  const displayName = unwrapped.toolName || toolName;
  const kind = classifyTool(displayName, args);
  const resultText = formatResultText(result);
  const progress =
    resultText == null && progressText ? progressText : null;
  const output = resultText ?? progress;
  let diffLines: DiffLine[] =
    kind === "edit"
      ? buildEditDiffLines(args)
      : kind === "write"
        ? (pickContentPreview(args) ?? "")
            .split("\n")
            .filter((line, _, arr) => !(arr.length === 1 && line === ""))
            .map((text, i) => ({
              kind: "add" as const,
              text,
              lineNo: i + 1,
              marker: "+" as const,
            }))
        : [];
  if (kind === "edit" && diffLines.length === 0) {
    diffLines = buildResultDiffLines(result);
  }
  const stats = countDiffStats(diffLines);
  const empty =
    !hasMeaningfulArgs(args) &&
    !output &&
    !pickContentPreview(args) &&
    diffLines.length === 0;

  return {
    kind,
    args,
    output,
    empty,
    path: pickPath(args) ?? pickPathFromResult(result),
    command: pickCommand(args),
    diffLines,
    stats,
  };
}

function ExtBadge({ path }: { path: string }) {
  const label = fileExtLabel(path);
  return (
    <span
      aria-hidden
      className="bg-sky-500/15 text-sky-600 dark:text-sky-400 flex size-5 shrink-0 items-center justify-center rounded-[4px] font-mono text-[9px] font-semibold leading-none"
    >
      {label.slice(0, 3)}
    </span>
  );
}

function ChangeStats({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="ms-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
      {additions > 0 ? (
        <span className="text-emerald-600 dark:text-emerald-400">
          +{additions}
        </span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-red-600 dark:text-red-400">-{deletions}</span>
      ) : null}
    </span>
  );
}

function DiffLinesView({ lines }: { lines: DiffLine[] }) {
  const truncated = lines.length > 120;
  const shown = truncated ? lines.slice(0, 120) : lines;
  const lastChangeIdx = (() => {
    for (let i = shown.length - 1; i >= 0; i--) {
      if (shown[i]?.kind === "add" || shown[i]?.kind === "del") return i;
    }
    return -1;
  })();

  return (
    <div className="font-mono text-[11px] leading-[1.55]">
      {shown.map((line, i) => {
        const isAdd = line.kind === "add";
        const isDel = line.kind === "del";
        const isHunk = line.kind === "hunk" || line.kind === "meta";
        const dimCtx =
          line.kind === "ctx" && lastChangeIdx >= 0 && i > lastChangeIdx;
        return (
          <div
            key={`${i}-${line.marker}-${line.text.slice(0, 32)}`}
            className={cn(
              "flex min-w-0",
              isAdd && "bg-emerald-500/10",
              isDel && "bg-red-500/10",
              isHunk && "bg-muted/40 text-sky-600 dark:text-sky-400",
              dimCtx && "opacity-45",
            )}
          >
            <span
              className={cn(
                "w-0.5 shrink-0",
                isAdd && "bg-emerald-500",
                isDel && "bg-red-500",
              )}
            />
            <span className="text-muted-foreground/70 w-8 shrink-0 select-none pe-2 text-right tabular-nums">
              {line.lineNo ?? ""}
            </span>
            <span
              className={cn(
                "w-3 shrink-0 select-none text-center",
                isAdd && "text-emerald-600 dark:text-emerald-400",
                isDel && "text-red-600 dark:text-red-400",
                !isAdd && !isDel && "text-muted-foreground/50",
              )}
            >
              {line.marker || " "}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 whitespace-pre-wrap break-all pe-2",
                isAdd && "text-foreground",
                isDel && "text-foreground/80",
                !isAdd && !isDel && !isHunk && "text-foreground/75",
              )}
            >
              {line.text || " "}
            </span>
          </div>
        );
      })}
      {truncated ? (
        <div className="text-muted-foreground px-3 py-1.5 text-[10px]">
          … 已截断
        </div>
      ) : null}
    </div>
  );
}

function CodeBlock({
  text,
  kind,
  path,
  streaming,
}: {
  text: string;
  kind?: ToolViewKind;
  path?: string;
  streaming?: boolean;
}) {
  return (
    <ToolCodeBlock
      text={text}
      kind={kind}
      path={path}
      streaming={streaming}
      className="px-2"
    />
  );
}

function SoftMeta({ label, value }: { label?: string; value: string }) {
  return (
    <div className="text-muted-foreground flex min-w-0 items-baseline gap-2 px-2.5 py-1 text-xs">
      {label ? <span className="shrink-0 opacity-70">{label}</span> : null}
      <span className="text-foreground/90 min-w-0 truncate font-mono">
        {value}
      </span>
    </div>
  );
}

/** 卡片外壳（与 Collapsible 配合：header 在外，body 在 Content 内） */
export function ToolCardShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="tool-card"
      className={cn(
        "border-border/70 bg-card/40 overflow-hidden rounded-(--radius) border text-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolCallCardHeaderTrigger({
  model,
  active = false,
  className,
}: {
  model: ToolCallModel;
  active?: boolean;
  className?: string;
}) {
  const { kind, path, command, stats } = model;

  if (kind === "shell") {
    const title = command
      ? command.length > 72
        ? `${command.slice(0, 72)}…`
        : command
      : "Terminal";
    return (
      <CollapsibleTrigger
        className={cn(
          "group/trigger border-border/60 bg-muted/30 hover:bg-muted/45 flex w-full cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-left",
          className,
        )}
      >
        <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-[4px]">
          <TerminalIcon className="size-3" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-xs",
            active
              ? "shimmer aui-shimmer motion-reduce:animate-none"
              : "text-foreground/90",
          )}
        >
          {title}
        </span>
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 opacity-70",
            "transition-transform duration-(--animation-duration,200ms)",
            "group-data-[state=closed]/trigger:rotate-0",
            "group-data-[state=open]/trigger:rotate-90",
          )}
        />
      </CollapsibleTrigger>
    );
  }

  const filePath = path ?? "file";
  return (
    <CollapsibleTrigger
      className={cn(
        "group/trigger border-border/60 bg-muted/30 hover:bg-muted/45 flex w-full cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-left",
        className,
      )}
    >
      <ExtBadge path={filePath} />
      <span
        className={cn(
          "min-w-0 truncate text-xs",
          active
            ? "shimmer aui-shimmer motion-reduce:animate-none"
            : "text-foreground/90",
        )}
      >
        {fileBasename(filePath)}
      </span>
      <ChangeStats {...stats} />
      <ChevronRightIcon
        aria-hidden
        className={cn(
          "text-muted-foreground size-3.5 shrink-0 opacity-70",
          "transition-transform duration-(--animation-duration,200ms)",
          "group-data-[state=closed]/trigger:rotate-0",
          "group-data-[state=open]/trigger:rotate-90",
        )}
      />
    </CollapsibleTrigger>
  );
}

export function ToolCallCardBody({
  model,
  streaming = false,
}: {
  model: ToolCallModel;
  streaming?: boolean;
}) {
  const { kind, args, output, path, command, diffLines } = model;

  if (kind === "shell") {
    return (
      <div className="bg-background/40 text-foreground/90 max-h-64 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed">
        {command ? (
          <div className="whitespace-pre-wrap break-all">
            <span className="text-muted-foreground select-none">$ </span>
            {command}
          </div>
        ) : null}
        {output ? (
          <div className="mt-1.5 max-h-48 overflow-auto opacity-90">
            <CodeBlock text={output} kind="shell" streaming={streaming} />
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === "edit" || kind === "write") {
    return (
      <div className="bg-background/40 max-h-64 overflow-auto">
        {diffLines.length > 0 ? (
          <DiffLinesView lines={diffLines} />
        ) : output ? (
          <CodeBlock text={output} kind={kind} path={path} streaming={streaming} />
        ) : null}
      </div>
    );
  }

  if (kind === "read") {
    return (
      <div className="bg-background/40 max-h-64 overflow-auto">
        {output ? (
          <CodeBlock text={output} kind="read" path={path} streaming={streaming} />
        ) : path ? (
          <SoftMeta value={path} />
        ) : null}
      </div>
    );
  }

  if (kind === "grep") {
    const pattern = pickPattern(args);
    const glob = pickGlob(args);
    return (
      <div className="bg-background/40 max-h-64 overflow-auto py-1">
        {pattern ? <SoftMeta label="pattern" value={pattern} /> : null}
        {path ? <SoftMeta label="path" value={path} /> : null}
        {glob ? <SoftMeta label="glob" value={glob} /> : null}
        {output ? (
          <CodeBlock text={output} kind="grep" streaming={streaming} />
        ) : null}
      </div>
    );
  }

  const entries = genericArgEntries(args);
  const raw = typeof args._raw === "string" ? args._raw : null;
  const content = pickContentPreview(args);
  return (
    <div className="bg-background/40 max-h-64 overflow-auto py-1">
      {raw ? (
        <CodeBlock text={raw} kind="generic" streaming={streaming} />
      ) : null}
      {entries.map(([key, value]) => (
        <SoftMeta key={key} label={key} value={value} />
      ))}
      {content ? (
        <CodeBlock text={content} kind={kind} path={path} streaming={streaming} />
      ) : null}
      {output ? (
        <CodeBlock text={output} kind={kind} path={path} streaming={streaming} />
      ) : null}
    </div>
  );
}

export type ToolCallBodyProps = {
  toolName: string;
  argsText?: string;
  result?: unknown;
  progressText?: string | null;
  className?: string;
  streaming?: boolean;
};

/** 完整卡片（用于展开后的 Read/Grep 等，header 不可点） */
export function ToolCallBody({
  toolName,
  argsText,
  result,
  progressText,
  className,
  streaming = false,
}: ToolCallBodyProps) {
  const model = buildToolCallModel(toolName, argsText, result, progressText);
  if (model.empty) return null;

  const staticHeader =
    model.kind === "shell" ? (
      <div className="border-border/60 bg-muted/30 flex items-center gap-2 border-b px-2.5 py-1.5">
        <span className="bg-muted text-muted-foreground flex size-5 items-center justify-center rounded-[4px]">
          <TerminalIcon className="size-3" />
        </span>
        <span className="text-foreground/90 min-w-0 truncate font-mono text-xs">
          {model.command
            ? model.command.length > 72
              ? `${model.command.slice(0, 72)}…`
              : model.command
            : "Terminal"}
        </span>
      </div>
    ) : model.path ? (
      <div className="border-border/60 bg-muted/30 flex items-center gap-2 border-b px-2.5 py-1.5">
        <ExtBadge path={model.path} />
        <span className="text-foreground/90 min-w-0 truncate text-xs">
          {fileBasename(model.path)}
        </span>
        <ChangeStats {...model.stats} />
      </div>
    ) : null;

  return (
    <ToolCardShell className={className}>
      {staticHeader}
      <ToolCallCardBody model={model} streaming={streaming} />
    </ToolCardShell>
  );
}
