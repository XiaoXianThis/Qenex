"use client";

import { ThreadMessagesArea, ThreadMessagesEditPreview } from "@/layout/puck/panels";
import { cn, selectComposerInTopBand, useLayoutStore } from "@qenex/core";
import type { SlotComponent } from "@puckeditor/core";
import {
  AuiIf,
  type AssistantState,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useEffect, type FC } from "react";
import type { LayoutPuckRoot } from "@/layout/puck/config";

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
};

export const ActiveThreadLayout: FC<ActiveThreadLayoutProps> = ({
  top: Top,
  bottom: Bottom,
  puckDataBottom,
  editMode,
  isEditing,
  topZoneClass,
}) => {
  const composerAtTop = useLayoutStore(selectComposerInTopBand);
  const layoutEditing = editMode || Boolean(isEditing);
  const hasBottom =
    layoutEditing ||
    (Array.isArray(puckDataBottom) && puckDataBottom.length > 0);

  const zoneClass =
    topZoneClass ??
    cn(
      layoutEditing
        ? "relative z-30 min-h-16 rounded-md border-2 border-dashed border-primary/25 p-2"
        : undefined,
    );

  const bottomZoneClass = cn(
    layoutEditing
      ? "min-h-16 rounded-md border-2 border-dashed border-primary/25 p-2"
      : undefined,
  );

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
        "aui-root aui-thread-root bg-background @container flex h-full min-h-0 flex-col overflow-hidden",
        layoutEditing && "pointer-events-none",
      )}
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.25rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <div
        className={cn(
          "relative shrink-0 overflow-hidden pt-2 page-padding-x",
          zoneClass,
          layoutEditing && "pointer-events-auto",
        )}
      >
        <div className="mx-auto w-full max-w-(--thread-max-width)">
          <Top />
        </div>
      </div>

      <ThreadPrimitive.Viewport
        turnAnchor={layoutEditing ? "bottom" : "top"}
        autoScroll={!layoutEditing}
        data-slot="aui_thread-viewport"
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden",
          layoutEditing && "pointer-events-none",
        )}
      >
        <div
          data-slot="aui_thread-messages"
          inert={layoutEditing ? true : undefined}
          className={cn(
            "page-padding-x-scroll page-padding-t flex min-h-0 flex-1 flex-col overflow-x-hidden scroll-smooth",
            layoutEditing
              ? "pointer-events-none select-none overflow-hidden [&_*]:pointer-events-none"
              : "overflow-y-auto",
          )}
        >
          {layoutEditing ? (
            <div className="mx-auto w-full max-w-(--thread-max-width)">
              <ThreadMessagesEditPreview />
            </div>
          ) : (
            <>
              <AuiIf condition={isNewChatView}>
                <div
                  className={cn(
                    "mx-auto flex w-full max-w-(--thread-max-width) flex-col",
                    !composerAtTop && "min-h-full justify-center",
                  )}
                >
                  <ThreadMessagesArea />
                </div>
              </AuiIf>
              <AuiIf condition={(s) => !isNewChatView(s)}>
                <div className="mx-auto w-full max-w-(--thread-max-width)">
                  <ThreadMessagesArea />
                </div>
              </AuiIf>
            </>
          )}
        </div>

        {hasBottom ? (
          <ThreadPrimitive.ViewportFooter
            data-slot="aui_thread-viewport-footer"
            className={cn(
              "aui-thread-viewport-footer bg-background page-padding-b shrink-0 flex flex-col gap-4 overflow-hidden rounded-t-(--composer-radius)",
              layoutEditing && "relative z-30 pointer-events-auto",
            )}
          >
            <div className={cn("mx-auto w-full max-w-(--thread-max-width)", bottomZoneClass)}>
              <Bottom />
            </div>
          </ThreadPrimitive.ViewportFooter>
        ) : null}
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};
