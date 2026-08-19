import type { UIMessage } from "ai";

export function messageTextLength(message: UIMessage | undefined): number {
  if (!message) return 0;
  return (message.parts ?? []).reduce(
    (length, part) =>
      part.type === "text" && typeof part.text === "string"
        ? length + part.text.length
        : length,
    0,
  );
}

function messagePartCount(message: UIMessage | undefined): number {
  return message?.parts?.length ?? 0;
}

export function persistedMessageIsRicher(
  persisted: UIMessage | undefined,
  current: UIMessage | undefined,
): boolean {
  if (!persisted || persisted.role !== "assistant") return false;
  const persistedText = messageTextLength(persisted);
  const currentText = messageTextLength(current);
  if (persistedText > currentText) return true;
  if (
    persistedText === currentText &&
    messagePartCount(persisted) > messagePartCount(current)
  ) {
    return true;
  }
  return false;
}

/**
 * After a finished / dropped SSE, decide whether to GET SQLite history.
 * Disconnect and stream errors commonly happen when a long tool outlives the
 * idle timer — Bridge still persists the completed turn.
 */
export function shouldReconcileChatFinish(input: {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  message: UIMessage;
}): boolean {
  if (input.isAbort) return false;
  if (input.isDisconnect || input.isError) return true;
  if (input.message.role !== "assistant") return true;
  return messageTextLength(input.message) === 0;
}
