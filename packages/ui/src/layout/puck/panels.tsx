"use client";

import { TabBar } from "@/components/TabBar";
import { ThreadFollowupSuggestions } from "@/components/assistant-ui/follow-up-suggestions";
import {
  ThreadComposer,
  ThreadMessages,
  ThreadScrollToBottom,
  ThreadSuggestions,
} from "@/components/assistant-ui/thread";
import { ApprovalPanel } from "@/layout/panels/ApprovalPanel";
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

/** 编辑模式下的轻量消息预览，避免完整 MessagePrimitive 树因历史数据缺字段而报错。
 * 挂点 / class 与真实 UserMessage / AssistantMessage 对齐，便于预览组件级 CSS。 */
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
    <div data-slot="aui_message-group" className="mb-14 flex flex-col gap-y-4 text-sm">
      {messages.map((message) => {
        const preview = messagePreviewText(message.content);
        const body = preview || "（非文本消息）";

        if (message.role === "user") {
          return (
            <div
              key={message.id}
              data-slot="aui_user-message-root"
              data-role="user"
              className="grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-4 [&:where(>*)]:col-start-2"
            >
              <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
                <div className="aui-user-message-content bg-card text-card-foreground rounded-xl px-4 py-2 wrap-break-word">
                  <span className="line-clamp-3 whitespace-pre-wrap">
                    {body}
                  </span>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            key={message.id}
            data-slot="aui_assistant-message-root"
            data-role="assistant"
            className="relative"
          >
            <div
              data-slot="aui_assistant-message-content"
              className="text-foreground px-4 leading-relaxed wrap-break-word"
            >
              <span className="line-clamp-3 whitespace-pre-wrap">{body}</span>
            </div>
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
      return null;
    case "undoRedo":
      return <ChangesPanel />;
    case "checklist":
      return null;
    case "approval":
      return <ApprovalPanel />;
    default:
      return null;
  }
}

export function ThreadMessagesArea() {
  return <ThreadMessages />;
}
