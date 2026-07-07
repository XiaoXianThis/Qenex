import { generateId, fromThreadMessageLike } from "@assistant-ui/core";
import type {
  ChatModelRunResult,
  ExportedMessageRepository,
  MessageStatus,
  ThreadAssistantMessagePart,
  ThreadMessage,
} from "@assistant-ui/core";
import type { ReadonlyJSONObject } from "assistant-stream/utils";
import type { AguiEvent } from "@/lib/bridge-agent";

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

function extractUserMessage(event: AguiEvent): ThreadMessage | null {
  if (event.type !== "CUSTOM" || event.name !== "user_message") {
    return null;
  }
  const value = event.value;
  if (!value || typeof value !== "object") return null;

  const record = value as {
    content?: unknown;
    message?: {
      role?: string;
      content?: unknown;
      attachments?: unknown;
    };
  };

  if (record.message?.role === "user") {
    const content = record.message.content;
    if (typeof content === "string" && content.length > 0) {
      return toUserMessage(content);
    }
    if (Array.isArray(content) && content.length > 0) {
      return fromThreadMessageLike(
        {
          id: generateId(),
          role: "user",
          content,
          ...(Array.isArray(record.message.attachments)
            ? { attachments: record.message.attachments }
            : {}),
        },
        generateId(),
        USER_STATUS,
      );
    }
  }

  if (typeof record.content === "string" && record.content.length > 0) {
    return toUserMessage(record.content);
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

function replayRunEvents(runEvents: AguiEvent[]): ThreadMessage | null {
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
      : ASSISTANT_COMPLETE;

  return toAssistantMessage(snapshot.content, status);
}

function isUserMessageEvent(event: AguiEvent): boolean {
  return extractUserMessage(event) !== null;
}

function splitIntoRuns(events: AguiEvent[]): AguiEvent[][] {
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

    if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
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
): ExportedMessageRepository {
  const messages: ExportedMessageRepository["messages"] = [];
  let parentId: string | null = null;

  for (const runEvents of splitIntoRuns(events)) {
    for (const event of runEvents) {
      const userMessage = extractUserMessage(event);
      if (!userMessage) continue;

      messages.push({ message: userMessage, parentId });
      parentId = userMessage.id;
    }

    const assistantMessage = replayRunEvents(runEvents);
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
