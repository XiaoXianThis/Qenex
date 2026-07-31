import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { BridgeError } from "./errors.ts";
import type { SessionStore } from "./session-store.ts";

export type ChatRequestBody = {
  sessionId?: string;
  messages?: UIMessage[];
  /** Reserved for Phase 3 — accepted but unused in Phase 1. */
  approvalMode?: "ask" | "auto";
};

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
  const provider = entry.provider;

  const modelMessages = await convertToModelMessages(body.messages);

  const result = streamText({
    model: provider.languageModel(),
    messages: modelMessages,
    tools: provider.tools,
    includeRawChunks: true,
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({
    headers: {
      "x-qenex-session-id": sessionId,
      "x-qenex-agent": "opencode",
    },
    messageMetadata: ({ part }) => {
      if (part.type === "raw" && "rawValue" in part && part.rawValue) {
        try {
          const raw =
            typeof part.rawValue === "string"
              ? JSON.parse(part.rawValue)
              : part.rawValue;
          if (raw && typeof raw === "object" && "type" in raw) {
            const t = (raw as { type: string }).type;
            if (t === "plan") return { plan: (raw as { entries?: unknown }).entries };
            if (t === "diff") return { diffs: [raw] };
            if (t === "terminal") return { terminals: [raw] };
          }
        } catch {
          /* ignore malformed raw */
        }
      }
      return undefined;
    },
  });
}
