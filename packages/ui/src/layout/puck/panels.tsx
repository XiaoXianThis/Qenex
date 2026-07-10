"use client";

import { TabBar } from "@/components/TabBar";
import { ThreadFollowupSuggestions } from "@/components/assistant-ui/follow-up-suggestions";
import {
  ThreadComposer,
  ThreadMessages,
  ThreadScrollToBottom,
  ThreadSuggestions,
} from "@/components/assistant-ui/thread";
import { WidgetPlaceholder } from "@/layout/panels/WidgetPlaceholder";
import { ChangesPanel } from "@/layout/panels/ChangesPanel";
import type { PanelId } from "@qenex/core";
import { AuiIf, useAuiState, type AssistantState } from "@assistant-ui/react";
import type { PanelRenderContext } from "@/layout/puck/types";

const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

function messagePreviewText(
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

/** 编辑模式下的轻量消息预览，避免完整 MessagePrimitive 树因历史数据缺字段而报错。 */
export function ThreadMessagesEditPreview() {
  const messages = useAuiState((s) => s.thread.messages);

  if (messages.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        暂无消息
      </div>
    );
  }

  return (
    <div className="mb-14 flex flex-col gap-y-4">
      {messages.map((message) => {
        const preview = messagePreviewText(message.content);
        const roleLabel = message.role === "user" ? "用户" : "助手";
        return (
          <div
            key={message.id}
            className="border-[1px] border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
          >
            <span className="font-medium text-foreground/80">{roleLabel}</span>
            {preview ? (
              <span className="mt-1 block line-clamp-3 whitespace-pre-wrap">
                {preview}
              </span>
            ) : (
              <span className="mt-1 block italic opacity-70">（非文本消息）</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function renderPanel(
  panelId: PanelId,
  ctx: PanelRenderContext,
): React.ReactNode {
  switch (panelId) {
    case "tabBar":
      return <TabBar position={ctx.shell.tabBarPosition} />;
    case "composer":
      return <ThreadComposer />;
    case "followupSuggestions":
      return <ThreadFollowupSuggestions />;
    case "scrollToBottom":
      return <ThreadScrollToBottom />;
    case "welcomeSuggestions":
      return (
        <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
          <ThreadSuggestions />
        </AuiIf>
      );
    case "tokenStats":
      return <WidgetPlaceholder panelId="tokenStats" />;
    case "undoRedo":
      return <ChangesPanel />;
    case "checklist":
      return <WidgetPlaceholder panelId="checklist" />;
    case "approval":
      return <WidgetPlaceholder panelId="approval" />;
    default:
      return null;
  }
}

export function ThreadMessagesArea() {
  return <ThreadMessages />;
}
