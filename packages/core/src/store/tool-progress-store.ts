import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";

/** Live tool execution output keyed by AG-UI toolCallId (CUSTOM tool_call_progress). */
export type ToolProgressState = {
  byId: Record<string, string>;
};

export const toolProgressStore = proxy<ToolProgressState>({
  byId: {},
});

export const toolProgressActions = {
  /** Replace snapshot text for a tool call (agents often send cumulative output). */
  setProgress(toolCallId: string, text: string) {
    if (!toolCallId) return;
    toolProgressStore.byId[toolCallId] = text;
  },

  clear(toolCallId: string) {
    delete toolProgressStore.byId[toolCallId];
  },

  clearAll() {
    toolProgressStore.byId = {};
  },
};

export function useToolProgress(toolCallId: string | undefined): string | null {
  const snap = useSnapshot(toolProgressStore);
  if (!toolCallId) return null;
  return snap.byId[toolCallId] ?? null;
}
