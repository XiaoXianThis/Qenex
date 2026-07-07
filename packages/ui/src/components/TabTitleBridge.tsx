import { useEffect } from "react";
import {
  getTaskTitle,
  useTabsStore,
  type BridgeHttpAgent,
} from "@qenex/core";

type TabTitleBridgeProps = {
  agent: BridgeHttpAgent;
  tabId: string;
  threadId: string;
};

export function TabTitleBridge({
  agent,
  tabId,
  threadId,
}: TabTitleBridgeProps) {
  const updateTabTitle = useTabsStore((s) => s.updateTabTitle);

  useEffect(() => {
    const syncTitleFromBackend = async () => {
      const title = await getTaskTitle(threadId);
      if (title?.trim()) {
        updateTabTitle(tabId, title.trim());
      }
    };

    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== "agent:session_title") {
          return;
        }

        const value = event.value as { title?: string } | undefined;
        if (typeof value?.title === "string" && value.title.trim()) {
          updateTabTitle(tabId, value.title.trim());
        }
      },
      onRunFinishedEvent: () => {
        void syncTitleFromBackend();
      },
    });

    return () => subscription.unsubscribe();
  }, [agent, tabId, threadId, updateTabTitle]);

  return null;
}
