"use client";

import { AgentRuntimeProvider } from "@/components/AgentRuntimeProvider";
import { HistoryPanel } from "@/components/HistoryPanel";
import type { LayoutPageProps } from "@/layout/puck/config";
import type { LayoutPuckRoot } from "@/layout/puck/config";
import { ActiveThreadLayout } from "@/layout/puck/ActiveThreadLayout";
import type { LayoutMetadata } from "@/layout/puck/types";
import { cn, useLayoutStore } from "@qenex/core";
import type { PuckComponent } from "@puckeditor/core";
import { RotateCcw } from "lucide-react";

export const LayoutPageRoot: PuckComponent<LayoutPageProps> = (props) => {
  const { top: Top, bottom: Bottom, puck } = props;
  const meta = puck.metadata as LayoutMetadata;
  const {
    showHistory,
    activeTabId,
    tabSessions,
    hasActiveTab,
    onResetLayout,
    shell,
  } = meta;

  const editMode = useLayoutStore((s) => s.editMode);
  const puckData = useLayoutStore((s) => s.puckData);
  const tabBarVisible = useLayoutStore((s) => s.panels.tabBar.visible);
  const composerHidden = useLayoutStore((s) => !s.panels.composer.visible);
  const showEmptyPanel =
    !tabBarVisible && composerHidden && !hasActiveTab && !showHistory;

  const rootProps = puckData.root?.props as LayoutPuckRoot | undefined;
  const bottomNodes = rootProps?.bottom;
  const isEditing = editMode || puck.isEditing;

  const topZoneClass = cn(
    "shrink-0 w-full",
    isEditing && "relative z-30 min-h-16 rounded-md border-2 border-dashed border-primary/25 p-2",
  );

  const idleCenter = showHistory ? (
    <HistoryPanel onRestore={() => shell.onToggleHistory()} />
  ) : !hasActiveTab && !showEmptyPanel ? (
    <div className="page-padding flex flex-1 items-center justify-center text-muted-foreground">
      选择 Agent 后点击 + 创建新会话
    </div>
  ) : showEmptyPanel ? (
    <div className="page-padding flex flex-1 flex-col items-center justify-center gap-4 text-center text-muted-foreground">
      <p>空面板 — 所有可选模块已隐藏</p>
      <button
        type="button"
        onClick={onResetLayout}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
      >
        <RotateCcw className="h-4 w-4" />
        恢复默认布局
      </button>
    </div>
  ) : null;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      data-layout-editing={isEditing ? "" : undefined}
    >
      {showHistory ? (
        <>
          <div className={topZoneClass}>
            <Top />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {idleCenter}
          </div>
        </>
      ) : tabSessions?.length > 0 ? (
        (() => {
          const session = tabSessions.find((s) => s.tabId === activeTabId);
          if (!session) {
            return (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {idleCenter}
              </div>
            );
          }
          return (
            <div className="flex h-dvh flex-col overflow-hidden">
              <AgentRuntimeProvider session={session}>
                <ActiveThreadLayout
                  top={Top}
                  bottom={Bottom}
                  puckDataBottom={bottomNodes}
                  editMode={editMode}
                  isEditing={isEditing}
                  topZoneClass={topZoneClass}
                />
              </AgentRuntimeProvider>
            </div>
          );
        })()
      ) : (
        <>
          <div className={topZoneClass}>
            <Top />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {idleCenter}
          </div>
        </>
      )}
    </div>
  );
};
