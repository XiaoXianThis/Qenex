import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  smoothStream,
  streamText,
  type UIMessage,
} from "ai";
import { BridgeError } from "./errors.ts";
import type { SessionStore } from "./session-store.ts";
import { isApprovalMode } from "./approval-manager.ts";
import { formatChatStreamError } from "./chat-errors.ts";
import { MessageMetadataAccumulator } from "./message-metadata.ts";
import { closeOpenUiPartsTransform } from "./ui-stream-close.ts";

export type ChatRequestBody = {
  sessionId?: string;
  messages?: UIMessage[];
  approvalMode?: "ask" | "auto";
};

type StreamTextTools = Parameters<typeof streamText>[0]["tools"];

const STABLE_STREAM_CHUNK_SIZE = 32;
const STREAM_BOUNDARY = /[\s,.;:!?，。；：！？、）)\]}]/u;

/**
 * Coalesce very small provider deltas before they reach React. The returned
 * chunks remain append-only; concatenating them always reproduces the exact
 * provider text.
 */
export function stableStreamChunk(buffer: string): string | null {
  const newline = buffer.indexOf("\n");
  if (newline >= 0) return buffer.slice(0, newline + 1);
  if (buffer.length < STABLE_STREAM_CHUNK_SIZE) return null;

  let end = STABLE_STREAM_CHUNK_SIZE;
  for (let index = end - 1; index >= STABLE_STREAM_CHUNK_SIZE / 2; index--) {
    if (STREAM_BOUNDARY.test(buffer[index]!)) {
      end = index + 1;
      break;
    }
  }
  // Do not split a UTF-16 surrogate pair across JSON/SSE events.
  const before = buffer.charCodeAt(end - 1);
  const after = buffer.charCodeAt(end);
  if (
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  ) {
    end -= 1;
  }
  return buffer.slice(0, end);
}

function positiveTimeout(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const CHAT_IDLE_TIMEOUT_MS = positiveTimeout(
  process.env.QENEX_CHAT_IDLE_TIMEOUT_MS,
  90_000,
);

export function withChatIdleTimeout<T>(
  source: ReadableStream<T>,
  timeoutMs: number,
  onTimeout: (error: Error) => void,
  onSettled: () => void = () => {},
): ReadableStream<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const settle = () => {
    if (settled) return false;
    settled = true;
    clear();
    onSettled();
    return true;
  };
  const arm = (controller: TransformStreamDefaultController<T>) => {
    clear();
    timer = setTimeout(() => {
      if (!settle()) return;
      const error = new Error(
        `Agent stream produced no data for ${timeoutMs}ms`,
      );
      error.name = "ChatIdleTimeoutError";
      onTimeout(error);
      controller.error(error);
    }, timeoutMs);
  };

  return source.pipeThrough(
    new TransformStream<T, T>({
      start(controller) {
        arm(controller);
      },
      transform(chunk, controller) {
        if (settled) return;
        arm(controller);
        controller.enqueue(chunk);
      },
      flush() {
        settle();
      },
    }),
  );
}

export async function handleChat(
  store: SessionStore,
  body: ChatRequestBody,
  req: Request,
): Promise<Response> {
  const sessionId =
    body.sessionId?.trim() ||
    req.headers.get("x-qenex-session-id")?.trim() ||
    undefined;
  if (!sessionId) {
    throw new BridgeError(
      "missing_session_id",
      "Request must include sessionId in JSON body or x-qenex-session-id header",
      400,
    );
  }
  if (!Array.isArray(body.messages)) {
    throw new BridgeError(
      "missing_messages",
      "Request body must include messages: UIMessage[]",
      400,
    );
  }

  // Reopen from SQLite after Bridge restart when needed.
  const entry = await store.ensureOpen(sessionId);
  if (body.approvalMode !== undefined && !isApprovalMode(body.approvalMode)) {
    throw new BridgeError(
      "invalid_approval_mode",
      'approvalMode must be "ask" or "auto"',
      400,
    );
  }
  entry.approvals.setMode(body.approvalMode ?? "ask");
  const provider = entry.provider;

  const modelMessages = await convertToModelMessages(body.messages);
  const metadata = new MessageMetadataAccumulator();
  const lease = await store.acquireSessionOperation(sessionId, "chat");
  const chatAbort = new AbortController();
  const abortChat = (reason?: unknown) => {
    if (!chatAbort.signal.aborted) chatAbort.abort(reason);
  };
  const forwardRequestAbort = () => {
    abortChat(req.signal.reason);
    store.interruptSessionOperation(sessionId);
  };
  const forwardLeaseAbort = () => abortChat(lease.signal.reason);

  if (req.signal.aborted || lease.signal.aborted) {
    lease.release();
    throw new BridgeError("request_aborted", "Chat request was cancelled", 499);
  }
  req.signal.addEventListener("abort", forwardRequestAbort, { once: true });
  lease.signal.addEventListener("abort", forwardLeaseAbort, { once: true });

  let released = false;
  const releaseLease = () => {
    if (released) return;
    released = true;
    req.signal.removeEventListener("abort", forwardRequestAbort);
    lease.signal.removeEventListener("abort", forwardLeaseAbort);
    lease.release();
  };

  try {
    const result = streamText({
      model: provider.languageModel(),
      messages: modelMessages,
      experimental_transform: smoothStream({
        delayInMs: null,
        chunking: stableStreamChunk,
      }),
      // Provider 0.3.x still publishes AI SDK 6 Tool types although its runtime
      // stream is compatible with AI SDK 7 (verified in Phase 0).
      tools: provider.tools as unknown as StreamTextTools,
      includeRawChunks: true,
      abortSignal: chatAbort.signal,
    });

    const stream = withChatIdleTimeout(
      result
        .toUIMessageStream({
          originalMessages: body.messages,
          messageMetadata: ({ part }) => metadata.ingest(part),
          // Local Bridge: surface real ACP/upstream errors (AI SDK default hides them).
          onError: (error) => formatChatStreamError(error, entry.info.agent),
          onEnd: ({ messages }) => {
            try {
              store.saveMessages(sessionId, messages);
            } catch (err) {
              console.error("[qenex-bridge] failed to persist messages:", err);
            }
          },
        })
        .pipeThrough(closeOpenUiPartsTransform()),
      CHAT_IDLE_TIMEOUT_MS,
      (error) => abortChat(error),
      releaseLease,
    );

    return createUIMessageStreamResponse({
      stream: releaseWhenStreamSettles(stream, releaseLease) as typeof stream &
        Parameters<typeof createUIMessageStreamResponse>[0]["stream"],
      headers: {
        "x-qenex-session-id": sessionId,
        "x-qenex-agent": entry.info.agent,
      },
    });
  } catch (err) {
    releaseLease();
    throw err;
  }
}

function releaseWhenStreamSettles<T>(
  source: ReadableStream<T>,
  onSettle: () => void,
): ReadableStream<T> {
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onSettle();
  };
  const reader = source.getReader();
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          settle();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        settle();
        controller.error(error);
      }
    },
    cancel(reason) {
      settle();
      return reader.cancel(reason);
    },
  });
}
