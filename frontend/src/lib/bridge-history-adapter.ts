import type { ThreadHistoryAdapter } from "@assistant-ui/core";
import type { AguiEvent } from "@/lib/bridge-agent";
import { replayAgUiEvents } from "@/lib/replay-agui-events";

export function createBridgeHistoryAdapter(
  loadEvents: (taskId: string) => Promise<AguiEvent[]>,
  taskId: string,
): ThreadHistoryAdapter {
  return {
    async load() {
      const events = await loadEvents(taskId);
      if (events.length === 0) {
        return { messages: [] };
      }
      return replayAgUiEvents(events);
    },
    async append() {
      // History is persisted on the backend; no local append needed.
    },
  };
}
