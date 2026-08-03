/**
 * Map ACP provider raw stream parts → UIMessage metadata.
 *
 * AI SDK `mergeObjects` replaces arrays instead of concatenating them, so the
 * provider README pattern `{ diffs: [one] }` would keep only the latest diff.
 * We accumulate in Bridge and return the full arrays on every update.
 */

export type PlanEntry = {
  content: string;
  priority?: string;
  status?: string;
};

export type DiffMeta = {
  type: "diff";
  path: string;
  oldText?: string | null;
  newText: string;
  toolCallId?: string;
};

export type TerminalMeta = {
  type: "terminal";
  terminalId: string;
  toolCallId?: string;
};

export type QenexMessageMetadata = {
  plan?: PlanEntry[];
  diffs?: DiffMeta[];
  terminals?: TerminalMeta[];
};

export type RawStreamPart = {
  type?: string;
  rawValue?: unknown;
};

function parseRawValue(rawValue: unknown): unknown {
  if (typeof rawValue === "string") {
    try {
      return JSON.parse(rawValue);
    } catch {
      return undefined;
    }
  }
  return rawValue;
}

function asPlanEntries(value: unknown): PlanEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: PlanEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (typeof content !== "string") continue;
    const priority = (item as { priority?: unknown }).priority;
    const status = (item as { status?: unknown }).status;
    entries.push({
      content,
      ...(typeof priority === "string" ? { priority } : {}),
      ...(typeof status === "string" ? { status } : {}),
    });
  }
  return entries;
}

function asDiff(raw: Record<string, unknown>): DiffMeta | undefined {
  if (typeof raw.path !== "string" || typeof raw.newText !== "string") {
    return undefined;
  }
  return {
    type: "diff",
    path: raw.path,
    newText: raw.newText,
    oldText:
      raw.oldText === null || typeof raw.oldText === "string"
        ? (raw.oldText as string | null)
        : undefined,
    ...(typeof raw.toolCallId === "string"
      ? { toolCallId: raw.toolCallId }
      : {}),
  };
}

function asTerminal(raw: Record<string, unknown>): TerminalMeta | undefined {
  if (typeof raw.terminalId !== "string") return undefined;
  return {
    type: "terminal",
    terminalId: raw.terminalId,
    ...(typeof raw.toolCallId === "string"
      ? { toolCallId: raw.toolCallId }
      : {}),
  };
}

function diffKey(diff: DiffMeta): string {
  return `${diff.toolCallId ?? ""}::${diff.path}`;
}

function terminalKey(terminal: TerminalMeta): string {
  return `${terminal.toolCallId ?? ""}::${terminal.terminalId}`;
}

/** Stateful accumulator used for one chat stream. */
export class MessageMetadataAccumulator {
  #plan: PlanEntry[] | undefined;
  #diffs = new Map<string, DiffMeta>();
  #terminals = new Map<string, TerminalMeta>();

  ingest(part: RawStreamPart): QenexMessageMetadata | undefined {
    if (part.type !== "raw" || part.rawValue == null || part.rawValue === "") {
      return undefined;
    }
    const parsed = parseRawValue(part.rawValue);
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      return undefined;
    }
    const raw = parsed as Record<string, unknown>;
    const t = raw.type;
    if (t === "plan") {
      const entries = asPlanEntries(raw.entries);
      if (!entries) return undefined;
      this.#plan = entries;
      return { plan: entries };
    }
    if (t === "diff") {
      const diff = asDiff(raw);
      if (!diff) return undefined;
      this.#diffs.set(diffKey(diff), diff);
      return { diffs: [...this.#diffs.values()] };
    }
    if (t === "terminal") {
      const terminal = asTerminal(raw);
      if (!terminal) return undefined;
      this.#terminals.set(terminalKey(terminal), terminal);
      return { terminals: [...this.#terminals.values()] };
    }
    return undefined;
  }

  snapshot(): QenexMessageMetadata {
    return {
      ...(this.#plan ? { plan: this.#plan } : {}),
      ...(this.#diffs.size ? { diffs: [...this.#diffs.values()] } : {}),
      ...(this.#terminals.size
        ? { terminals: [...this.#terminals.values()] }
        : {}),
    };
  }
}
