/** Skip useChat assistant rows that duplicate an in-thread message this turn. */
export function isDuplicateLiveAssistant(opts: {
  messageId: string;
  messages: readonly { id: string; role: string }[];
  threadIds: readonly string[];
}): boolean {
  const { messageId, messages, threadIds } = opts;
  let lastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") lastUser = i;
  }
  const turn = messages.slice(lastUser + 1);
  const hasThreadAssistant = turn.some(
    (message) =>
      message.role === "assistant" && threadIds.includes(message.id),
  );
  if (!hasThreadAssistant) return false;
  return !threadIds.includes(messageId);
}

/**
 * Only the last in-thread assistant may show ●. Hide it while a newer user
 * message is already in useChat (optimistic wait owns the caret instead).
 */
export function assistantMessageCaretVisible(opts: {
  isLastThreadMessage: boolean;
  busy: boolean;
  lastChatRole: string | undefined;
}): boolean {
  return Boolean(
    opts.busy &&
      opts.isLastThreadMessage &&
      opts.lastChatRole !== "user",
  );
}
