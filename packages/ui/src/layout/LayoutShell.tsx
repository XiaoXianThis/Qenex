"use client";

import { PuckLayoutRenderer } from "@/layout/puck/PuckLayoutRenderer";
import { LayoutEditToolbar } from "@/layout/LayoutEditToolbar";
import {
  layoutActions,
  selectTabBarPosition,
  useLayoutStore,
  type RuntimeSessionConfig,
} from "@qenex/core";
import type { FC } from "react";

type LayoutShellProps = {
  showHistory: boolean;
  onToggleHistory: () => void;
  archivedCount: number;
  activeTabId: string | null;
  tabSessions: RuntimeSessionConfig[];
  hasActiveTab: boolean;
};

export const LayoutShell: FC<LayoutShellProps> = ({
  showHistory,
  onToggleHistory,
  archivedCount,
  activeTabId,
  tabSessions,
  hasActiveTab,
}) => {
  const editMode = useLayoutStore((s) => s.editMode);
  const composerHidden = useLayoutStore((s) => !s.panels.composer.visible);
  const tabBarPosition = useLayoutStore(selectTabBarPosition);
  const resetToDefault = layoutActions.resetToDefault;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <PuckLayoutRenderer
        metadata={{
          showHistory,
          activeTabId,
          tabSessions,
          hasActiveTab,
          onResetLayout: resetToDefault,
          shell: {
            showHistory,
            onToggleHistory,
            archivedCount,
            tabBarPosition,
          },
        }}
      />
      <LayoutEditToolbar />
      {composerHidden && editMode ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-4">
          <div className="pointer-events-auto border-t border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-700 dark:text-amber-300">
            输入框已隐藏，当前无法发送消息。
            <button
              type="button"
              className="ms-2 underline"
              onClick={resetToDefault}
            >
              恢复默认
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
