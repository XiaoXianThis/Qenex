import type { ReactNode } from "react";
import {
  parseMessageMetadata,
  type DiffMeta,
  type PlanEntry,
  type TerminalMeta,
  cn,
} from "@qenex/core";

function statusLabel(status?: string): string {
  switch (status) {
    case "completed":
      return "完成";
    case "in_progress":
      return "进行中";
    case "pending":
      return "待办";
    default:
      return status ?? "";
  }
}

function PlanPanel({ entries }: { entries: PlanEntry[] }): ReactNode {
  return (
    <section
      className="border-border/60 bg-muted/20 mt-3 rounded-xl border px-3 py-2 text-sm"
      aria-label="计划"
    >
      <div className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
        Plan
      </div>
      <ol className="flex flex-col gap-1.5">
        {entries.map((entry, index) => (
          <li
            key={`${entry.content}-${index}`}
            className="flex flex-wrap items-baseline gap-2"
            data-status={entry.status ?? ""}
          >
            <span className="text-muted-foreground shrink-0 text-xs">
              {statusLabel(entry.status) || "步骤"}
            </span>
            <span className="min-w-0 flex-1 leading-relaxed">{entry.content}</span>
            {entry.priority ? (
              <span className="text-muted-foreground text-xs">{entry.priority}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function DiffPanel({ diffs }: { diffs: DiffMeta[] }): ReactNode {
  return (
    <section
      className="border-border/60 bg-muted/20 mt-3 rounded-xl border px-3 py-2 text-sm"
      aria-label="文件变更"
    >
      <div className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
        Diff
      </div>
      <div className="flex flex-col gap-3">
        {diffs.map((diff, index) => (
          <article
            key={`${diff.toolCallId ?? ""}-${diff.path}-${index}`}
            className="min-w-0"
          >
            <div className="mb-1 font-mono text-xs">
              <code>{diff.path}</code>
            </div>
            {diff.oldText ? (
              <pre
                className="bg-destructive/5 text-destructive mb-1 max-h-48 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap"
                aria-label="旧内容"
              >
                {diff.oldText}
              </pre>
            ) : null}
            <pre
              className="bg-emerald-500/5 text-emerald-800 dark:text-emerald-200 max-h-48 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap"
              aria-label="新内容"
            >
              {diff.newText}
            </pre>
          </article>
        ))}
      </div>
    </section>
  );
}

function TerminalPanel({ terminals }: { terminals: TerminalMeta[] }): ReactNode {
  return (
    <section
      className="border-border/60 bg-muted/20 mt-3 rounded-xl border px-3 py-2 text-sm"
      aria-label="终端"
    >
      <div className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
        Terminal
      </div>
      <ul className="flex flex-col gap-1">
        {terminals.map((terminal, index) => (
          <li
            key={`${terminal.toolCallId ?? ""}-${terminal.terminalId}-${index}`}
            className="font-mono text-xs"
          >
            终端输出 · <code>{terminal.terminalId}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Read-only ACP plan / diff / terminal from UIMessage.metadata.
 * Malformed metadata is ignored — never throws.
 */
export function MessageArtifacts({
  metadata,
  className,
}: {
  metadata: unknown;
  className?: string;
}): ReactNode {
  const parsed = parseMessageMetadata(metadata);
  if (!parsed) return null;
  return (
    <div className={cn("flex flex-col", className)}>
      {parsed.plan?.length ? <PlanPanel entries={parsed.plan} /> : null}
      {parsed.diffs?.length ? <DiffPanel diffs={parsed.diffs} /> : null}
      {parsed.terminals?.length ? (
        <TerminalPanel terminals={parsed.terminals} />
      ) : null}
    </div>
  );
}
