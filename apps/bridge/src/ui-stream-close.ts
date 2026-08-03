/**
 * Close open text/reasoning UIMessage parts before finish-step / finish.
 *
 * Root cause (verified against live OpenCode ACP SSE, 2026-08-03):
 * `@mcpc-tech/acp-ai-provider@0.3.4` emits `text-start`/`text-delta` for
 * `agent_message_chunk`, but only emits `text-end` when transitioning to a
 * tool call — not when the prompt ends. AI SDK's client then hits
 * `finish-step`, which clears `activeTextParts` without setting `state:"done"`,
 * leaving the part as `streaming` while `useChat.status` is already `ready`.
 *
 * Upstream: provider bug (latest npm is still 0.3.4). AI SDK / assistant-ui
 * versions are already current; updating them does not fix this.
 */

type UiChunk = {
  type: string;
  id?: string;
  [key: string]: unknown;
};

function closeOpenParts(
  openText: Set<string>,
  openReasoning: Set<string>,
  controller: TransformStreamDefaultController<UiChunk>,
) {
  for (const id of openText) {
    controller.enqueue({ type: "text-end", id });
  }
  openText.clear();
  for (const id of openReasoning) {
    controller.enqueue({ type: "reasoning-end", id });
  }
  openReasoning.clear();
}

/** Inject missing text-end / reasoning-end before step/message finish. */
export function closeOpenUiPartsTransform(): TransformStream<
  UiChunk,
  UiChunk
> {
  const openText = new Set<string>();
  const openReasoning = new Set<string>();

  return new TransformStream<UiChunk, UiChunk>({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "text-start":
          if (typeof chunk.id === "string") openText.add(chunk.id);
          break;
        case "text-end":
          if (typeof chunk.id === "string") openText.delete(chunk.id);
          break;
        case "reasoning-start":
          if (typeof chunk.id === "string") openReasoning.add(chunk.id);
          break;
        case "reasoning-end":
          if (typeof chunk.id === "string") openReasoning.delete(chunk.id);
          break;
        case "finish-step":
        case "finish":
          closeOpenParts(openText, openReasoning, controller);
          break;
        default:
          break;
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      closeOpenParts(openText, openReasoning, controller);
    },
  });
}
