/** Minimal tool-call fields used to decide the header swipe animation. */
export type ToolCallShimmerInput = {
  status?: { type: string } | undefined;
  result?: unknown;
  isError?: boolean;
};

/**
 * Swipe/shimmer only while this invocation is still in flight.
 *
 * assistant-ui maps missing results to the parent message's `running` status
 * via `!part.result`, so empty-string / null results (common for write/shell)
 * keep animating until the whole turn ends. Treat any defined result as done.
 * `chatBusy` is useChat submitted/streaming — part.status can stay `running`
 * after the stream closes.
 */
export function isToolCallShimmerActive(
  part: ToolCallShimmerInput,
  chatBusy: boolean,
): boolean {
  if (part.isError) return false;
  if (part.result !== undefined) return false;
  const type = part.status?.type;
  if (type === "requires-action") return true;
  return type === "running" && chatBusy;
}
