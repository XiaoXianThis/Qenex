import { generateId, fromThreadMessageLike } from "@assistant-ui/core";
import type {
  ChatModelRunResult,
  ExportedMessageRepository,
  MessageStatus,
  ThreadAssistantMessagePart,
  ThreadMessage,
} from "@assistant-ui/core";
import type { ReadonlyJSONObject } from "assistant-stream/utils";
import type { AguiEvent } from "./bridge-agent.ts";

const USER_STATUS = { type: "complete", reason: "unknown" } as const;
const ASSISTANT_COMPLETE: MessageStatus = {
  type: "complete",
  reason: "unknown",
};

type ToolCallState = {
  toolCallId: string;
  toolName: string;
  argsText: string;
  parsedArgs: ReadonlyJSONObject | undefined;
  result: unknown;
  isError: boolean | undefined;
  parentMessageId?: string;
  toolMessageId?: string;
};

type PartRef =
  | { kind: "text"; key: string }
  | { kind: "reasoning"; key: string }
  | { kind: "tool-call"; toolCallId: string };

function tryParseJson(value: string): unknown {
  if (!value) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toUserMessage(content: string): ThreadMessage {
  return fromThreadMessageLike(
    { id: generateId(), role: "user", content },
    generateId(),
    USER_STATUS,
  );
}

function toAssistantMessage(
  content: readonly ThreadAssistantMessagePart[],
  status: MessageStatus = ASSISTANT_COMPLETE,
): ThreadMessage {
  return fromThreadMessageLike(
    { id: generateId(), role: "assistant", content, status },
    generateId(),
    ASSISTANT_COMPLETE,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

/** AG-UI `{ source: { type, value, mimeType } }` → data URL / URL string. */
function inputSourceToDataUrl(
  source: unknown,
): { value: string; mimeType?: string } | null {
  if (!isRecord(source)) return null;
  const sourceValue = getString(source, "value");
  if (sourceValue === undefined) return null;
  const mimeType = getString(source, "mimeType");
  const type = getString(source, "type");
  if (type === "url") {
    return { value: sourceValue, ...(mimeType !== undefined && { mimeType }) };
  }
  if (type === "data" || type === undefined) {
    if (sourceValue.startsWith("data:") || /^(https?:\/\/|blob:)/.test(sourceValue)) {
      return {
        value: sourceValue,
        mimeType: mimeType ?? mimeFromDataUrl(sourceValue),
      };
    }
    const resolvedMime = mimeType ?? "application/octet-stream";
    return {
      value: `data:${resolvedMime};base64,${sourceValue}`,
      mimeType: resolvedMime,
    };
  }
  return null;
}

function mimeFromDataUrl(value: string): string | undefined {
  const match = /^data:([^;]+);base64,/.exec(value);
  return match?.[1];
}

type SnapshotAttachment = {
  id: string;
  type: "image" | "document" | "file" | "audio" | "data";
  name: string;
  contentType?: string;
  status: { type: "complete" };
  content: Array<
    | { type: "image"; image: string; filename?: string }
    | { type: "file"; data: string; mimeType: string; filename?: string }
    | { type: "text"; text: string }
  >;
};

/**
 * Convert persisted AG-UI multimodal user content into assistant-ui
 * text content + attachments (UI renders images from attachments).
 */
export function agUiUserContentToThreadParts(content: unknown): {
  text: string;
  attachments: SnapshotAttachment[];
} {
  if (typeof content === "string") {
    return { text: content, attachments: [] };
  }
  if (!Array.isArray(content)) {
    return { text: "", attachments: [] };
  }

  const textParts: string[] = [];
  const attachments: SnapshotAttachment[] = [];

  for (const rawPart of content) {
    if (!isRecord(rawPart)) continue;
    const type = getString(rawPart, "type");

    if (type === "text") {
      const text = getString(rawPart, "text");
      if (text) textParts.push(text);
      continue;
    }

    // Already assistant-ui shaped: { type: "image", image: "data:..." }
    if (type === "image" && typeof rawPart.image === "string") {
      const image = rawPart.image;
      const filename =
        getString(rawPart, "filename") ??
        (isRecord(rawPart.metadata) ? getString(rawPart.metadata, "filename") : undefined);
      const id = String(attachments.length);
      attachments.push({
        id,
        type: "image",
        name: filename ?? "image",
        contentType: mimeFromDataUrl(image) ?? "image/png",
        status: { type: "complete" },
        content: [
          {
            type: "image",
            image,
            ...(filename !== undefined && { filename }),
          },
        ],
      });
      continue;
    }

    // AG-UI multimodal: { type: "image"|"document"|..., source: {...} }
    if (
      type === "image" ||
      type === "document" ||
      type === "file" ||
      type === "audio" ||
      type === "video" ||
      type === "binary"
    ) {
      let part = rawPart;
      if (type === "binary") {
        const mimeType = getString(rawPart, "mimeType");
        const data = getString(rawPart, "data");
        const url = getString(rawPart, "url");
        if (!mimeType || (!data && !url)) continue;
        part = {
          type: mimeType.startsWith("image/") ? "image" : "document",
          source: data
            ? { type: "data", value: data, mimeType }
            : { type: "url", value: url, mimeType },
          ...(getString(rawPart, "filename")
            ? { metadata: { filename: getString(rawPart, "filename") } }
            : {}),
        };
      }

      const partType = getString(part, "type");
      const source = inputSourceToDataUrl(part.source);
      if (!source || !partType) continue;

      const filename = isRecord(part.metadata)
        ? getString(part.metadata, "filename")
        : getString(part, "filename");
      const id = String(attachments.length);

      if (partType === "image" || source.mimeType?.startsWith("image/")) {
        attachments.push({
          id,
          type: "image",
          name: filename ?? "image",
          ...(source.mimeType !== undefined && { contentType: source.mimeType }),
          status: { type: "complete" },
          content: [
            {
              type: "image",
              image: source.value,
              ...(filename !== undefined && { filename }),
            },
          ],
        });
      } else {
        const mimeType = source.mimeType ?? "application/octet-stream";
        attachments.push({
          id,
          type: partType === "document" ? "document" : "file",
          name: filename ?? "file",
          contentType: mimeType,
          status: { type: "complete" },
          content: [
            {
              type: "file",
              data: source.value,
              mimeType,
              ...(filename !== undefined && { filename }),
            },
          ],
        });
      }
    }
  }

  return {
    text: textParts.join("\n"),
    attachments,
  };
}

function normalizePersistedAttachments(
  attachments: unknown,
): SnapshotAttachment[] {
  if (!Array.isArray(attachments)) return [];
  const result: SnapshotAttachment[] = [];
  for (const raw of attachments) {
    if (!isRecord(raw)) continue;
    const type = getString(raw, "type") ?? "file";
    const name = getString(raw, "name") ?? "file";
    const contentType = getString(raw, "contentType");
    const id = getString(raw, "id") ?? String(result.length);

    // CompleteAttachment with nested content parts
    if (Array.isArray(raw.content)) {
      const { text: _t, attachments: nested } = agUiUserContentToThreadParts(
        raw.content,
      );
      if (nested.length > 0) {
        for (const att of nested) {
          result.push({ ...att, id: `${id}-${att.id}`, name: att.name || name });
        }
        continue;
      }
    }

    // Legacy flat { type, data, mimeType }
    if (type === "image") {
      const data = getString(raw, "data") ?? getString(raw, "image");
      if (!data) continue;
      const mime = contentType ?? getString(raw, "mimeType") ?? "image/png";
      const image = data.startsWith("data:")
        ? data
        : `data:${mime};base64,${data}`;
      result.push({
        id,
        type: "image",
        name,
        contentType: mime,
        status: { type: "complete" },
        content: [{ type: "image", image }],
      });
    }
  }
  return result;
}

function extractUserMessage(
  event: AguiEvent,
  runId?: string,
): ThreadMessage | null {
  if (event.type !== "CUSTOM" || event.name !== "user_message") {
    return null;
  }
  const value = event.value;
  if (!value || typeof value !== "object") return null;

  const record = value as {
    content?: unknown;
    message?: {
      id?: string;
      role?: string;
      content?: unknown;
      attachments?: unknown;
    };
  };

  const customMeta =
    runId != null && runId.length > 0
      ? { metadata: { custom: { runId } } }
      : {};

  if (record.message?.role === "user") {
    const { text, attachments: fromContent } = agUiUserContentToThreadParts(
      record.message.content,
    );
    const fromField = normalizePersistedAttachments(record.message.attachments);
    const attachments = [...fromContent, ...fromField];

    if (!text && attachments.length === 0) {
      return null;
    }

    const persistedId =
      typeof record.message.id === "string" && record.message.id.length > 0
        ? record.message.id
        : undefined;

    return fromThreadMessageLike(
      {
        id: persistedId ?? generateId(),
        role: "user",
        // Image-only turns: empty content array (avoid blank text bubble)
        content: text.length > 0 ? text : [],
        ...(attachments.length > 0 ? { attachments } : {}),
        ...customMeta,
      },
      generateId(),
      USER_STATUS,
    );
  }

  if (typeof record.content === "string" && record.content.length > 0) {
    return fromThreadMessageLike(
      {
        id: generateId(),
        role: "user",
        content: record.content,
        ...customMeta,
      },
      generateId(),
      USER_STATUS,
    );
  }

  return null;
}

function getStringField(event: AguiEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" ? value : undefined;
}

class RunReplayAggregator {
  private textParts = new Map<string, { buffer: string; touched: boolean }>();
  private activeTextMessageId: string | undefined;
  private textPartCounter = 0;

  private reasoningParts = new Map<string, string>();
  private activeReasoningKey: string | undefined;
  private reasoningPartCounter = 0;

  private toolCalls = new Map<string, ToolCallState>();
  private partOrder: PartRef[] = [];

  private status: ChatModelRunResult["status"] | undefined;
  private lastUpdate: ChatModelRunResult | null = null;

  reset() {
    this.textParts.clear();
    this.activeTextMessageId = undefined;
    this.textPartCounter = 0;
    this.reasoningParts.clear();
    this.activeReasoningKey = undefined;
    this.reasoningPartCounter = 0;
    this.toolCalls.clear();
    this.partOrder = [];
    this.status = undefined;
    this.lastUpdate = null;
  }

  handle(event: AguiEvent) {
    switch (event.type) {
      case "RUN_STARTED":
        this.reset();
        this.status = { type: "running" };
        this.emit();
        return;
      case "RUN_FINISHED":
        this.status = { type: "complete", reason: "unknown" };
        this.emit();
        return;
      case "RUN_ERROR": {
        const message = getStringField(event, "message");
        this.status = {
          type: "incomplete",
          reason: "error",
          ...(message ? { error: message } : {}),
        };
        this.emit();
        return;
      }
      case "RUN_CANCELLED":
        this.status = { type: "incomplete", reason: "cancelled" };
        this.emit();
        return;
      case "TEXT_MESSAGE_START":
        this.startTextMessage(getStringField(event, "messageId"));
        this.emit();
        return;
      case "TEXT_MESSAGE_CONTENT":
      case "TEXT_MESSAGE_CHUNK": {
        const delta = getStringField(event, "delta");
        if (!delta) return;
        const id = this.resolveTextMessageId(getStringField(event, "messageId"));
        this.appendText(id, delta);
        this.emit();
        return;
      }
      case "TEXT_MESSAGE_END":
        if (
          getStringField(event, "messageId") &&
          this.activeTextMessageId === getStringField(event, "messageId")
        ) {
          this.activeTextMessageId = undefined;
        }
        this.emit();
        return;
      case "REASONING_START":
      case "REASONING_MESSAGE_START":
      case "THINKING_START":
      case "THINKING_TEXT_MESSAGE_START":
        this.handleReasoningStart(getStringField(event, "messageId"));
        this.emit();
        return;
      case "REASONING_MESSAGE_CONTENT":
      case "THINKING_TEXT_MESSAGE_CONTENT": {
        const delta = getStringField(event, "delta");
        if (!delta) return;
        this.handleReasoningContent(delta, getStringField(event, "messageId"));
        this.emit();
        return;
      }
      case "REASONING_MESSAGE_END":
      case "REASONING_END":
      case "THINKING_END":
      case "THINKING_TEXT_MESSAGE_END":
        this.activeReasoningKey = undefined;
        this.emit();
        return;
      case "TOOL_CALL_START":
        this.startToolCall(
          getStringField(event, "toolCallId"),
          getStringField(event, "toolCallName") ?? getStringField(event, "name"),
          getStringField(event, "parentMessageId"),
        );
        this.emit();
        return;
      case "TOOL_CALL_ARGS":
      case "TOOL_CALL_CHUNK": {
        const delta = getStringField(event, "delta");
        if (!delta) return;
        this.appendToolArgs(getStringField(event, "toolCallId"), delta, {
          toolName:
            getStringField(event, "toolCallName") ?? getStringField(event, "name"),
          parentMessageId: getStringField(event, "parentMessageId"),
        });
        this.emit();
        return;
      }
      case "TOOL_CALL_END":
        this.emit();
        return;
      case "TOOL_CALL_RESULT":
        this.finishToolCall(
          getStringField(event, "toolCallId"),
          getStringField(event, "content") ?? "",
          event.role === "tool" ? false : undefined,
          getStringField(event, "messageId"),
        );
        this.emit();
        return;
      default:
        return;
    }
  }

  getSnapshot(): ChatModelRunResult | null {
    return this.lastUpdate;
  }

  private emit() {
    const content: ThreadAssistantMessagePart[] = [];

    for (const part of this.partOrder) {
      if (part.kind === "text") {
        const entry = this.textParts.get(part.key);
        if (entry?.touched && entry.buffer) {
          content.push({ type: "text", text: entry.buffer });
        }
        continue;
      }

      if (part.kind === "reasoning") {
        const text = this.reasoningParts.get(part.key) ?? "";
        if (text) content.push({ type: "reasoning", text });
        continue;
      }

      const entry = this.toolCalls.get(part.toolCallId);
      if (!entry) continue;

      content.push({
        type: "tool-call",
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
        args: entry.parsedArgs ?? {},
        argsText: entry.argsText,
        ...(entry.result !== undefined ? { result: entry.result } : {}),
        ...(entry.isError !== undefined ? { isError: entry.isError } : {}),
        ...(entry.parentMessageId ? { parentId: entry.parentMessageId } : {}),
        ...(entry.toolMessageId
          ? { unstable_toolMessageId: entry.toolMessageId }
          : {}),
      });
    }

    this.lastUpdate = {
      content,
      ...(this.status ? { status: this.status } : {}),
    };
  }

  private startTextMessage(messageId?: string) {
    const id = messageId ?? `text-${++this.textPartCounter}`;
    this.ensureTextPart(id);
    this.activeTextMessageId = id;
    const entry = this.textParts.get(id);
    if (entry) entry.touched = true;
  }

  private resolveTextMessageId(messageId?: string) {
    if (messageId) {
      this.ensureTextPart(messageId);
      this.activeTextMessageId = messageId;
      return messageId;
    }
    if (this.activeTextMessageId) return this.activeTextMessageId;
    const generated = `text-${++this.textPartCounter}`;
    this.ensureTextPart(generated);
    this.activeTextMessageId = generated;
    return generated;
  }

  private ensureTextPart(id: string) {
    if (!this.textParts.has(id)) {
      this.textParts.set(id, { buffer: "", touched: false });
      if (!this.partOrder.some((p) => p.kind === "text" && p.key === id)) {
        this.partOrder.push({ kind: "text", key: id });
      }
    }
  }

  private appendText(id: string, delta: string) {
    this.ensureTextPart(id);
    const entry = this.textParts.get(id);
    if (!entry) return;
    entry.buffer += delta;
    entry.touched = true;
  }

  private handleReasoningStart(messageId?: string) {
    this.activeTextMessageId = undefined;
    const key = messageId ?? `reasoning-${++this.reasoningPartCounter}`;
    if (!this.reasoningParts.has(key)) {
      this.reasoningParts.set(key, "");
      this.partOrder.push({ kind: "reasoning", key });
    }
    this.activeReasoningKey = key;
  }

  private handleReasoningContent(delta: string, messageId?: string) {
    if (!this.activeReasoningKey) {
      this.handleReasoningStart(messageId);
    }
    const key = this.activeReasoningKey;
    if (!key) return;
    this.reasoningParts.set(key, (this.reasoningParts.get(key) ?? "") + delta);
  }

  private ensureToolPart(toolCallId: string) {
    if (
      !this.partOrder.some(
        (part) => part.kind === "tool-call" && part.toolCallId === toolCallId,
      )
    ) {
      this.partOrder.push({ kind: "tool-call", toolCallId });
    }
  }

  private startToolCall(
    toolCallId: string | undefined,
    toolName: string | undefined,
    parentMessageId?: string,
  ) {
    if (!toolCallId) return;
    this.activeTextMessageId = undefined;
    this.ensureToolPart(toolCallId);
    const existing = this.toolCalls.get(toolCallId);
    this.toolCalls.set(toolCallId, {
      toolCallId,
      toolName: toolName ?? existing?.toolName ?? "tool",
      argsText: existing?.argsText ?? "",
      parsedArgs: existing?.parsedArgs,
      result: existing?.result,
      isError: existing?.isError,
      ...(parentMessageId ? { parentMessageId } : {}),
      ...(existing?.toolMessageId ? { toolMessageId: existing.toolMessageId } : {}),
    });
  }

  private appendToolArgs(
    toolCallId: string | undefined,
    delta: string,
    hints?: { toolName?: string; parentMessageId?: string },
  ) {
    if (!toolCallId) return;
    if (!this.toolCalls.has(toolCallId)) {
      this.startToolCall(toolCallId, hints?.toolName, hints?.parentMessageId);
    }
    const entry = this.toolCalls.get(toolCallId);
    if (!entry) return;
    entry.argsText += delta;
    try {
      const parsed = JSON.parse(entry.argsText);
      if (parsed && typeof parsed === "object") {
        entry.parsedArgs = parsed as ReadonlyJSONObject;
      }
    } catch {
      entry.parsedArgs = undefined;
    }
  }

  private finishToolCall(
    toolCallId: string | undefined,
    content: string,
    isError?: boolean,
    toolMessageId?: string,
  ) {
    if (!toolCallId) return;
    if (!this.toolCalls.has(toolCallId)) {
      this.startToolCall(toolCallId, undefined);
    }
    this.ensureToolPart(toolCallId);
    const entry = this.toolCalls.get(toolCallId)!;
    entry.result = tryParseJson(content);
    if (isError !== undefined) entry.isError = isError;
    if (toolMessageId) entry.toolMessageId = toolMessageId;
  }
}

function replayRunEvents(
  runEvents: AguiEvent[],
  options?: { preserveRunning?: boolean },
): ThreadMessage | null {
  const aggregator = new RunReplayAggregator();

  for (const event of runEvents) {
    if (event.type === "CUSTOM") continue;
    aggregator.handle(event);
  }

  const snapshot = aggregator.getSnapshot();
  if (!snapshot?.content?.length) {
    return null;
  }

  const status: MessageStatus =
    snapshot.status?.type === "incomplete"
      ? snapshot.status
      : snapshot.status?.type === "running" && options?.preserveRunning
        ? { type: "running" }
        : ASSISTANT_COMPLETE;

  return toAssistantMessage(snapshot.content, status);
}

function isUserMessageEvent(event: AguiEvent): boolean {
  return extractUserMessage(event) !== null;
}

function isTerminalEvent(event: AguiEvent): boolean {
  return event.type === "RUN_FINISHED" || event.type === "RUN_ERROR";
}

/** True when the latest run has started but not finished/errored. */
export function hasIncompleteRun(events: AguiEvent[]): boolean {
  let incomplete = false;
  for (const event of events) {
    if (event.type === "RUN_STARTED") {
      incomplete = true;
    } else if (isTerminalEvent(event)) {
      incomplete = false;
    }
  }
  return incomplete;
}

export function splitIntoRuns(events: AguiEvent[]): AguiEvent[][] {
  const runs: AguiEvent[][] = [];
  let pendingPrefix: AguiEvent[] = [];
  let current: AguiEvent[] = [];

  for (const event of events) {
    if (event.type === "RUN_STARTED") {
      if (current.length > 0) {
        runs.push(current);
      }
      current = [...pendingPrefix, event];
      pendingPrefix = [];
      continue;
    }

    if (current.length === 0) {
      if (isUserMessageEvent(event)) {
        pendingPrefix.push(event);
      } else if (pendingPrefix.length > 0) {
        pendingPrefix.push(event);
      } else {
        current = [event];
      }
      continue;
    }

    current.push(event);

    if (isTerminalEvent(event)) {
      runs.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    runs.push(current);
  } else if (pendingPrefix.length > 0) {
    runs.push(pendingPrefix);
  }

  return runs;
}

export function replayAgUiEvents(
  events: AguiEvent[],
  options?: { preserveRunning?: boolean },
): ExportedMessageRepository {
  const messages: ExportedMessageRepository["messages"] = [];
  let parentId: string | null = null;

  for (const runEvents of splitIntoRuns(events)) {
    const runId = runEvents.find((e) => e.type === "RUN_STARTED")?.runId;
    const runIdStr = typeof runId === "string" ? runId : undefined;

    for (const event of runEvents) {
      const userMessage = extractUserMessage(event, runIdStr);
      if (!userMessage) continue;

      messages.push({ message: userMessage, parentId });
      parentId = userMessage.id;
    }

    const assistantMessage = replayRunEvents(runEvents, options);
    if (assistantMessage) {
      messages.push({ message: assistantMessage, parentId });
      parentId = assistantMessage.id;
    }
  }

  return {
    messages,
    headId: parentId,
  };
}

export { RunReplayAggregator };
