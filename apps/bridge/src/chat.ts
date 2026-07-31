import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { BridgeError } from "./errors.ts";
import type { SessionStore } from "./session-store.ts";
import { isApprovalMode } from "./approval-manager.ts";
import { MessageMetadataAccumulator } from "./message-metadata.ts";

export type ChatRequestBody = {
  sessionId?: string;
  messages?: UIMessage[];
  approvalMode?: "ask" | "auto";
};

type StreamTextTools = Parameters<typeof streamText>[0]["tools"];

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

  const entry = store.get(sessionId);
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

  const result = streamText({
    model: provider.languageModel(),
    messages: modelMessages,
    // Provider 0.3.x still publishes AI SDK 6 Tool types although its runtime
    // stream is compatible with AI SDK 7 (verified in Phase 0).
    tools: provider.tools as unknown as StreamTextTools,
    includeRawChunks: true,
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({
    headers: {
      "x-qenex-session-id": sessionId,
      "x-qenex-agent": "opencode",
    },
    messageMetadata: ({ part }) => metadata.ingest(part),
  });
}
