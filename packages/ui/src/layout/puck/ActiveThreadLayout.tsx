"use client";

import { ThreadWelcome } from "@/components/assistant-ui/thread";
import { ThreadMessagesArea, ThreadMessagesEditPreview } from "@/layout/puck/panels";
import {
  cn,
  getPanelDefinition,
  resolveStyleComponentTarget,
  selectComposerInTopBand,
  selectTabBarPosition,
  styleActions,
  useLayoutStore,
} from "@qenex/core";
import type { SlotComponent } from "@puckeditor/core";
import {
  AuiIf,
  type AssistantState,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { PaintbrushVertical } from "lucide-react";
import { useEffect, type FC, type SyntheticEvent } from "react";
import {
  LAYOUT_ROOT_BOTTOM_LABEL,
  LAYOUT_ROOT_TOP_LABEL,
  layoutRootSlotClass,
  type LayoutPuckRoot,
} from "@/layout/puck/config";
import { LayoutContainerSlot } from "@/layout/puck/LayoutContainerSlot";
import { LayoutEditLabel } from "@/layout/puck/LayoutEditLabel";

const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

const MessagesStyleEditButton: FC = () => {
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <button
      type="button"
      data-layout-messages-style-edit=""
      className="pointer-events-auto absolute top-0 right-0 z-30 inline-flex cursor-pointer items-center gap-1 rounded-bl bg-primary/90 px-1.5 py-0.5 text-[10px] leading-none font-medium text-primary-foreground shadow-sm hover:bg-primary"
      aria-label="编辑消息区样式"
      onClick={(e) => {
        stop(e);
        const target = resolveStyleComponentTarget("messages");
        if (target) styleActions.openComponentStyleEdit(target);
      }}
      onPointerDown={stop}
      onMouseDown={stop}
    >
      <PaintbrushVertical size={12} aria-hidden />
      编辑样式
    </button>
  );
};

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
          className={cn(
            "relative page-padding-x-scroll page-padding-t flex min-h-full flex-col",
            layoutEditing &&
              "min-h-8 overflow-hidden border-[1px] border-dashed border-primary/40",
          )}
        >
          {layoutEditing ? (
            <>
              <LayoutEditLabel label={getPanelDefinition("messages").label} />
              <MessagesStyleEditButton />
              <div
                inert
                className="pointer-events-none select-none mx-auto w-full max-w-(--thread-max-width) [&_*]:pointer-events-none"
              >
                <ThreadMessagesEditPreview />
              </div>
            </>
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
