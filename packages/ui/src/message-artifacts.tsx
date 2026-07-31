import type { ReactNode } from "react";
import {
  parseMessageMetadata,
  type DiffMeta,
  type PlanEntry,
  type TerminalMeta,
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
    <section className="qenex-artifact qenex-plan" aria-label="计划">
      <div className="qenex-artifact-kicker">Plan</div>
      <ol className="qenex-plan-list">
        {entries.map((entry, index) => (
          <li key={`${entry.content}-${index}`} data-status={entry.status ?? ""}>
            <span className="qenex-plan-status">
              {statusLabel(entry.status) || "步骤"}
            </span>
            <span className="qenex-plan-content">{entry.content}</span>
            {entry.priority ? (
              <span className="qenex-plan-priority">{entry.priority}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function DiffPanel({ diffs }: { diffs: DiffMeta[] }): ReactNode {
  return (
    <section className="qenex-artifact qenex-diffs" aria-label="文件变更">
      <div className="qenex-artifact-kicker">Diff</div>
      {diffs.map((diff, index) => (
        <article
          key={`${diff.toolCallId ?? ""}-${diff.path}-${index}`}
          className="qenex-diff"
        >
          <div className="qenex-diff-path">
            <code>{diff.path}</code>
          </div>
          {diff.oldText ? (
            <pre className="qenex-diff-old" aria-label="旧内容">
              {diff.oldText}
            </pre>
          ) : null}
          <pre className="qenex-diff-new" aria-label="新内容">
            {diff.newText}
          </pre>
        </article>
      ))}
    </section>
  );
}

function TerminalPanel({ terminals }: { terminals: TerminalMeta[] }): ReactNode {
  return (
    <section className="qenex-artifact qenex-terminals" aria-label="终端">
      <div className="qenex-artifact-kicker">Terminal</div>
      <ul className="qenex-terminal-list">
        {terminals.map((terminal, index) => (
          <li key={`${terminal.toolCallId ?? ""}-${terminal.terminalId}-${index}`}>
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
}: {
  metadata: unknown;
}): ReactNode {
  const parsed = parseMessageMetadata(metadata);
  if (!parsed) return null;
  return (
    <div className="qenex-artifacts">
      {parsed.plan?.length ? <PlanPanel entries={parsed.plan} /> : null}
      {parsed.diffs?.length ? <DiffPanel diffs={parsed.diffs} /> : null}
      {parsed.terminals?.length ? (
        <TerminalPanel terminals={parsed.terminals} />
      ) : null}
    </div>
  );
}
