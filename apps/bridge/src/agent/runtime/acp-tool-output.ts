/**
 * Provider 0.3.4 drops ACP `content` text (stdout / search snippets) on
 * `in_progress`, and `rawOutput ?? content` treats `{}` / `[]` as a real
 * result — Codex Web Search then lands as output-available with `output: null`.
 * Recover text for the tool-result stream. Remove when the provider emits
 * in-progress text and treats empty rawOutput as missing (pin > 0.3.4).
 */

export type AcpSessionUpdate = {
  sessionUpdate?: string;
  toolCallId?: string;
  status?: string | null;
  rawOutput?: unknown;
  content?: unknown;
  [key: string]: unknown;
};

export function isEmptyToolRawOutput(raw: unknown): boolean {
  if (raw == null) return true;
  if (raw === "") return true;
  if (Array.isArray(raw) && raw.length === 0) return true;
  if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0) {
    return true;
  }
  return false;
}

export function extractAcpContentText(content: unknown, depth = 0): string | null {
  if (depth > 8 || content == null) return null;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? content : null;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => extractAcpContentText(item, depth + 1))
      .filter((text): text is string => Boolean(text));
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (typeof content !== "object") return null;
  const o = content as Record<string, unknown>;
  if (typeof o.formatted_output === "string" && o.formatted_output) {
    return o.formatted_output;
  }
  if (typeof o.text === "string" && o.text) return o.text;
  if (o.type === "content") return extractAcpContentText(o.content, depth + 1);
  if (typeof o.content === "string" && o.content) return o.content;
  if (typeof o.output === "string" && o.output) return o.output;
  if (typeof o.stdout === "string" && o.stdout) return o.stdout;
  if (o.content != null && typeof o.content === "object") {
    return extractAcpContentText(o.content, depth + 1);
  }
  return null;
}

function asFailedIterable(rawOutput: unknown, content: unknown): unknown {
  if (Array.isArray(rawOutput)) return rawOutput;
  if (Array.isArray(content)) return content;
  if (typeof rawOutput === "string" && rawOutput) {
    return [
      { type: "content", content: { type: "text", text: rawOutput } },
    ];
  }
  return [];
}

/** Accumulates in-progress ACP text and fills empty rawOutput on complete/fail. */
export class AcpToolOutputRecovery {
  #chunks = new Map<string, string[]>();

  patch(update: AcpSessionUpdate | undefined): AcpSessionUpdate | undefined {
    if (!update) return update;
    const id =
      typeof update.toolCallId === "string" ? update.toolCallId : undefined;

    if (update.sessionUpdate === "tool_call") {
      if (id) this.#chunks.delete(id);
      return update;
    }
    if (update.sessionUpdate !== "tool_call_update") return update;

    const extracted = extractAcpContentText(update.content);
    if (id && extracted) {
      const prev = this.#chunks.get(id) ?? [];
      const last = prev[prev.length - 1];
      if (last && extracted.startsWith(last)) {
        prev[prev.length - 1] = extracted;
      } else if (last && last.startsWith(extracted)) {
        // ignore a smaller cumulative snapshot
      } else if (last !== extracted) {
        prev.push(extracted);
      }
      this.#chunks.set(id, prev);
    }

    const terminal =
      update.status === "completed" || update.status === "failed";
    const accumulated = id ? (this.#chunks.get(id) ?? []).join("\n") : "";
    if (terminal && id) this.#chunks.delete(id);

    let rawOutput = update.rawOutput;
    if (isEmptyToolRawOutput(rawOutput) && accumulated) {
      rawOutput = accumulated;
    }

    // Provider 0.3.4: failed-tool formatter assumes rawOutput is iterable.
    if (update.status === "failed" && !Array.isArray(rawOutput)) {
      rawOutput = asFailedIterable(rawOutput, update.content);
    }

    if (rawOutput === update.rawOutput) return update;
    return { ...update, rawOutput };
  }
}
