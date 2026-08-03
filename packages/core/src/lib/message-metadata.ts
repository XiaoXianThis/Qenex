/**
 * Defensive parse of UIMessage.metadata (plan / diffs / terminals).
 * Never throws — malformed fields are ignored.
 */

export type PlanEntry = {
  content: string;
  priority?: string;
  status?: string;
};

export type DiffMeta = {
  type?: "diff";
  path: string;
  oldText?: string | null;
  newText: string;
  toolCallId?: string;
};

export type TerminalMeta = {
  type?: "terminal";
  terminalId: string;
  toolCallId?: string;
};

export type QenexMessageMetadata = {
  plan?: PlanEntry[];
  diffs?: DiffMeta[];
  terminals?: TerminalMeta[];
};

export function parseMessageMetadata(
  value: unknown,
): QenexMessageMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const out: QenexMessageMetadata = {};

  if (Array.isArray(raw.plan)) {
    const plan: PlanEntry[] = [];
    for (const item of raw.plan) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (typeof content !== "string") continue;
      const priority = (item as { priority?: unknown }).priority;
      const status = (item as { status?: unknown }).status;
      plan.push({
        content,
        ...(typeof priority === "string" ? { priority } : {}),
        ...(typeof status === "string" ? { status } : {}),
      });
    }
    if (plan.length) out.plan = plan;
  }

  if (Array.isArray(raw.diffs)) {
    const diffs: DiffMeta[] = [];
    for (const item of raw.diffs) {
      if (!item || typeof item !== "object") continue;
      const path = (item as { path?: unknown }).path;
      const newText = (item as { newText?: unknown }).newText;
      if (typeof path !== "string" || typeof newText !== "string") continue;
      const oldText = (item as { oldText?: unknown }).oldText;
      const toolCallId = (item as { toolCallId?: unknown }).toolCallId;
      diffs.push({
        type: "diff",
        path,
        newText,
        ...(typeof oldText === "string" || oldText === null
          ? { oldText: oldText as string | null }
          : {}),
        ...(typeof toolCallId === "string" ? { toolCallId } : {}),
      });
    }
    if (diffs.length) out.diffs = diffs;
  }

  if (Array.isArray(raw.terminals)) {
    const terminals: TerminalMeta[] = [];
    for (const item of raw.terminals) {
      if (!item || typeof item !== "object") continue;
      const terminalId = (item as { terminalId?: unknown }).terminalId;
      if (typeof terminalId !== "string") continue;
      const toolCallId = (item as { toolCallId?: unknown }).toolCallId;
      terminals.push({
        type: "terminal",
        terminalId,
        ...(typeof toolCallId === "string" ? { toolCallId } : {}),
      });
    }
    if (terminals.length) out.terminals = terminals;
  }

  if (!out.plan && !out.diffs && !out.terminals) return undefined;
  return out;
}
