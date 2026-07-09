"use client";

import { ThreadWelcome } from "@/components/assistant-ui/thread";
import { ThreadMessagesArea, ThreadMessagesEditPreview } from "@/layout/puck/panels";
import { cn, selectComposerInTopBand, selectTabBarPosition, useLayoutStore } from "@qenex/core";
import type { SlotComponent } from "@puckeditor/core";
import {
  AuiIf,
  type AssistantState,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useEffect, type FC } from "react";
import {
  LAYOUT_ROOT_BOTTOM_LABEL,
  LAYOUT_ROOT_TOP_LABEL,
  layoutRootSlotClass,
  type LayoutPuckRoot,
} from "@/layout/puck/config";
import { LayoutContainerSlot } from "@/layout/puck/LayoutContainerSlot";

const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

type ActiveThreadLayoutProps = {
  top: SlotComponent;
  bottom: SlotComponent;
  puckDataBottom: LayoutPuckRoot["bottom"];
  editMode: boolean;
  isEditing?: boolean;
  topZoneClass?: string;
  /** 为 false 时不渲染顶部区（TabBar 由外层稳定挂载） */
  renderTop?: boolean;
};

export const ActiveThreadLayout: FC<ActiveThreadLayoutProps> = ({
  top: Top,
  bottom: Bottom,
  puckDataBottom,
  editMode,
  isEditing,
  topZoneClass,
  renderTop = true,
}) => {
  const composerAtTop = useLayoutStore(selectComposerInTopBand);
  const tabBarPosition = useLayoutStore(selectTabBarPosition);
  const layoutEditing = editMode || Boolean(isEditing);
  const hasBottom =
    layoutEditing ||
    (Array.isArray(puckDataBottom) && puckDataBottom.length > 0);

  const zoneClass = topZoneClass ?? (layoutEditing ? "relative z-30" : undefined);
  const flushTopTabBar = !layoutEditing && tabBarPosition === "top";
  const flushBottomComposer = !layoutEditing && !composerAtTop;

  useEffect(() => {
    if (!layoutEditing) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  }, [layoutEditing]);

  return (
    <ThreadPrimitive.Root
      className={cn(
        // 上 / 中 / 下三层：上下 shrink-0 实占，中间 flex-1 滚动
        "aui-root aui-thread-root bg-background @container flex h-full min-h-0 flex-col overflow-hidden",
        layoutEditing && "pointer-events-none",
      )}
    >
      {renderTop ? (
        <div
          className={cn(
            "relative shrink-0 overflow-hidden",
            layoutEditing
              ? "pointer-events-auto"
              : !flushTopTabBar && "pt-2 page-padding-x",
            zoneClass,
          )}
        >
          <div
            className={cn(
              "w-full",
              (layoutEditing || !flushTopTabBar) &&
                "mx-auto max-w-(--thread-max-width)",
            )}
          >
            <LayoutContainerSlot
              label={LAYOUT_ROOT_TOP_LABEL}
              componentType="root.top"
              editing={layoutEditing}
              className={layoutRootSlotClass(layoutEditing)}
            >
              {Top}
            </LayoutContainerSlot>
          </div>
        </div>
      ) : null}

      <ThreadPrimitive.Viewport
        turnAnchor={layoutEditing ? "bottom" : "top"}
        autoScroll={!layoutEditing}
        data-slot="aui_thread-viewport"
        className={cn(
          "relative min-h-0 flex-1 overflow-x-hidden scroll-smooth",
          layoutEditing
            ? "overflow-hidden pointer-events-none"
            : "overflow-y-auto",
        )}
      >
        <div
          data-layout-panel="messages"
          data-slot="aui_thread-messages"
          inert={layoutEditing ? true : undefined}
          className={cn(
            "relative page-padding-x-scroll page-padding-t flex min-h-full flex-col",
            layoutEditing &&
              "pointer-events-none select-none overflow-hidden opacity-40 [&_*]:pointer-events-none",
          )}
        >
          {layoutEditing ? (
            <div className="mx-auto w-full max-w-(--thread-max-width)">
              <ThreadMessagesEditPreview />
            </div>
          ) : (
            <>
              <AuiIf condition={isNewChatView}>
                <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
                  <ThreadWelcome />
                </div>
              </AuiIf>
              <AuiIf condition={(s) => !isNewChatView(s)}>
                <div className="relative z-10 mx-auto w-full max-w-(--thread-max-width)">
                  <ThreadMessagesArea />
                </div>
              </AuiIf>
            </>
          )}
        </div>
      </ThreadPrimitive.Viewport>

      {hasBottom ? (
        <div
          data-slot="aui_thread-viewport-footer"
          className={cn(
            "aui-thread-viewport-footer bg-background shrink-0 flex flex-col gap-4 overflow-hidden",
            layoutEditing
              ? "relative z-30 pointer-events-auto"
              : cn(
                  "rounded-t-(--composer-radius)",
                  !flushBottomComposer && "page-padding-b",
                ),
          )}
        >
          <div className="mx-auto w-full max-w-(--thread-max-width)">
            <LayoutContainerSlot
              label={LAYOUT_ROOT_BOTTOM_LABEL}
              componentType="root.bottom"
              editing={layoutEditing}
              className={layoutRootSlotClass(layoutEditing)}
            >
              {Bottom}
            </LayoutContainerSlot>
          </div>
        </div>
      ) : null}
    </ThreadPrimitive.Root>
  );
};
