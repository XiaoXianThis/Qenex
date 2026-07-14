"use client";

import { AgentRuntimeProvider } from "@/components/AgentRuntimeProvider";
import type { LayoutPageProps } from "@/layout/puck/config";
import {
  LAYOUT_ROOT_TOP_LABEL,
  layoutRootSlotClass,
  type LayoutPuckRoot,
} from "@/layout/puck/config";
import { LayoutContainerSlot } from "@/layout/puck/LayoutContainerSlot";
import { ActiveThreadLayout } from "@/layout/puck/ActiveThreadLayout";
import type { LayoutMetadata } from "@/layout/puck/types";
import {
  cn,
  selectTabBarPosition,
  useLayoutStore,
  useTabsStore,
  type RuntimeSessionConfig,
} from "@qenex/core";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import type { PuckComponent } from "@puckeditor/core";
import { RotateCcw } from "lucide-react";
import { useMemo, type FC, type ReactNode } from "react";

const EDIT_PREVIEW_ADAPTER: ChatModelAdapter = {
  async *run() {
    // 布局编辑预览不发起真实对话
  },
};

/** Puck iframe 内无真实会话时，提供最小 AuiProvider，避免 Composer 等面板报错 */
const EditPreviewRuntimeProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const runtime = useLocalRuntime(EDIT_PREVIEW_ADAPTER);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};

function sessionsFromTabs(
  tabs: Array<{
    id: string;
    status: string;
    taskId: string;
    agentId: string;
    cwd: string;
    agentCommand?: string[];
    agentSessionId?: string;
    needsHistoryLoad?: boolean;
  }>,
): RuntimeSessionConfig[] {
  return tabs
    .filter((t) => t.status === "active")
    .map((tab) => ({
      tabId: tab.id,
      threadId: tab.taskId,
      agentId: tab.agentId,
      cwd: tab.cwd,
      agentCommand:
        tab.agentCommand && tab.agentCommand.length > 0
          ? tab.agentCommand
          : undefined,
      agentSessionId: tab.agentSessionId,
      shouldLoadHistory: tab.needsHistoryLoad === true,
    }));
}

export const LayoutPageRoot: PuckComponent<LayoutPageProps> = (props) => {
  const { top: Top, bottom: Bottom, puck } = props;
  const meta = puck.metadata as LayoutMetadata;
  const { onResetLayout } = meta;

  // 主窗口用 live tabs store；Puck iframe 内 store 为空时回退 metadata
  const storeTabs = useTabsStore((s) => s.tabs);
  const storeActiveTabId = useTabsStore((s) => s.activeTabId);
  const storeSessions = useMemo(
    () => sessionsFromTabs(storeTabs),
    [storeTabs],
  );

  const useMetaFallback = storeSessions.length === 0 && meta.tabSessions.length > 0;
  const activeTabId = useMetaFallback ? meta.activeTabId : storeActiveTabId;
  const tabSessions = useMetaFallback ? meta.tabSessions : storeSessions;
  const hasActiveTab = useMetaFallback
    ? meta.hasActiveTab
    : Boolean(activeTabId && storeTabs.some((t) => t.id === activeTabId));

  const editMode = useLayoutStore((s) => s.editMode);
  const puckData = useLayoutStore((s) => s.puckData);
  const tabBarVisible = useLayoutStore((s) => s.panels.tabBar.visible);
  const composerHidden = useLayoutStore((s) => !s.panels.composer.visible);
  const tabBarPosition = useLayoutStore(selectTabBarPosition);
  const showEmptyPanel = !tabBarVisible && composerHidden && !hasActiveTab;

  const rootProps = puckData.root?.props as LayoutPuckRoot | undefined;
  const bottomNodes = rootProps?.bottom;
  const isEditing = editMode || puck.isEditing;

  const topZoneClass = cn("shrink-0 w-full", isEditing && "relative z-30");
  const flushTopTabBar = !isEditing && tabBarPosition === "top";

  const idleCenter = !hasActiveTab && !showEmptyPanel ? (
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

  const stableTop = (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden",
        isEditing
          ? "pointer-events-auto"
          : !flushTopTabBar && "pt-2 page-padding-x",
        topZoneClass,
      )}
    >
      <div
        className={cn(
          "w-full",
          (isEditing || !flushTopTabBar) &&
            "mx-auto max-w-(--thread-max-width)",
        )}
      >
        <LayoutContainerSlot
          label={LAYOUT_ROOT_TOP_LABEL}
          componentType="root.top"
          editing={isEditing}
          className={layoutRootSlotClass(isEditing)}
        >
          {Top}
        </LayoutContainerSlot>
      </div>
    </div>
  );

  const activeSession = useMemo((): RuntimeSessionConfig | undefined => {
    if (!activeTabId) return undefined;
    return tabSessions.find((s) => s.tabId === activeTabId);
  }, [activeTabId, tabSessions]);

  const page = (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      data-layout-page=""
      data-layout-editing={isEditing ? "" : undefined}
    >
      {stableTop}
      {activeSession || isEditing ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ActiveThreadLayout
            key={activeSession?.tabId ?? "edit-preview"}
            top={Top}
            bottom={Bottom}
            puckDataBottom={bottomNodes}
            editMode={editMode}
            isEditing={isEditing}
            topZoneClass={topZoneClass}
            renderTop={false}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {idleCenter}
        </div>
      )}
    </div>
  );

  // 为所有 active tab 保活 Runtime：切 Tab 只切换可见 children，不 unmount Provider，
  // 避免进行中的 SSE / 内存消息丢失。
  if (tabSessions.length > 0 && !useMetaFallback) {
    return (
      <>
        {tabSessions.map((session) => {
          const isActive = session.tabId === activeTabId;
          return (
            <AgentRuntimeProvider key={session.tabId} session={session}>
              {isActive ? page : null}
            </AgentRuntimeProvider>
          );
        })}
      </>
    );
  }

  // Provider 包住整页（含稳定挂载的顶部栏），避免顶部区里的 AUI 面板脱离上下文
  if (activeSession) {
    return (
      <AgentRuntimeProvider key={activeSession.tabId} session={activeSession}>
        {page}
      </AgentRuntimeProvider>
    );
  }

  // 编辑预览（含 iframe）无真实会话时仍需 AuiProvider
  if (isEditing) {
    return <EditPreviewRuntimeProvider>{page}</EditPreviewRuntimeProvider>;
  }

  return page;
};
