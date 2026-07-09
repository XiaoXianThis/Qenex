import { useEffect, useRef } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  getTaskTitle,
  tabsActions,
  tabsStore,
  updateTaskTitle,
  useTabsStore,
  type BridgeHttpAgent,
} from "@qenex/core";

type TabTitleBridgeProps = {
  agent: BridgeHttpAgent;
  tabId: string;
  threadId: string;
};

function isPlaceholderTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim() ?? "";
  if (!trimmed) return true;
  if (trimmed === "New Task" || trimmed === "AG-UI Session" || trimmed === "新会话") {
    return true;
  }
  if (/^会话\s*\d+$/.test(trimmed)) return true;
  return /^新.+会话$/.test(trimmed);
}

function titleFromUserMessage(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= 50) return cleaned;
  const truncated = cleaned.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated}…`;
}

function messageText(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function TabTitleBridge({
  agent,
  tabId,
  threadId,
}: TabTitleBridgeProps) {
  const updateTabTitle = tabsActions.updateTabTitle;
  const currentTitle = useTabsStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.title ?? "",
  );
  const agentTitleAppliedRef = useRef(false);
  const fallbackAppliedRef = useRef(false);

  const firstUserMessageText = useAuiState((s) => {
    const firstUser = s.thread.messages.find((m) => m.role === "user");
    if (!firstUser) return "";
    return messageText(firstUser.content);
  });

  useEffect(() => {
    const title = tabsStore.tabs.find((t) => t.id === tabId)?.title;
    const hasRealTitle = !isPlaceholderTitle(title);
    agentTitleAppliedRef.current = false;
    fallbackAppliedRef.current = hasRealTitle;
  }, [tabId, threadId]);

  useEffect(() => {
    const applyTitle = (title: string, fromAgent: boolean) => {
      const next = title.trim();
      if (!next) return;
      if (fromAgent) {
        agentTitleAppliedRef.current = true;
      } else if (agentTitleAppliedRef.current) {
        return;
      }
      updateTabTitle(tabId, next);
      void updateTaskTitle(threadId, next).catch((error) => {
        console.warn("Failed to persist tab title:", error);
      });
    };

    const syncTitleFromBackend = async () => {
      const title = await getTaskTitle(threadId);
      if (!title?.trim() || isPlaceholderTitle(title)) {
        return;
      }
      applyTitle(title, true);
    };

    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== "agent:session_title") {
          return;
        }

        const value = event.value as { title?: string } | undefined;
        if (typeof value?.title === "string" && value.title.trim()) {
          applyTitle(value.title, true);
        }
      },
      onRunFinishedEvent: () => {
        void syncTitleFromBackend();
      },
    });

    return () => subscription.unsubscribe();
  }, [agent, tabId, threadId, updateTabTitle]);

  useEffect(() => {
    if (!firstUserMessageText.trim()) {
      return;
    }
    tabsActions.markTabHasChatContent(tabId);
  }, [firstUserMessageText, tabId]);

  useEffect(() => {
    if (agentTitleAppliedRef.current || fallbackAppliedRef.current) {
      return;
    }
    if (!isPlaceholderTitle(currentTitle)) {
      return;
    }
    const next = titleFromUserMessage(firstUserMessageText);
    if (!next) {
      return;
    }
    fallbackAppliedRef.current = true;
    updateTabTitle(tabId, next);
    void updateTaskTitle(threadId, next).catch((error) => {
      console.warn("Failed to persist fallback tab title:", error);
    });
  }, [currentTitle, firstUserMessageText, tabId, threadId, updateTabTitle]);

  return null;
}
