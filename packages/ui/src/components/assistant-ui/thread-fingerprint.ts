/** Cheap primitive for useAuiState — avoid map/join on every store tick. */
export function threadMessagesFingerprint(
  messages: readonly { id: string }[],
): string {
  return `${messages.length}:${messages.at(-1)?.id ?? ""}`;
}
