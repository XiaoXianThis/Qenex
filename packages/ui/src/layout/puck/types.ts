"use client";

import type { RuntimeSessionConfig } from "@qenex/core";
import type { ReactNode } from "react";

export type ShellPanelContext = {
  showHistory: boolean;
  onToggleHistory: () => void;
  archivedCount: number;
  tabBarPosition: "top" | "bottom";
};

export type LayoutMetadata = {
  shell: ShellPanelContext;
  showHistory: boolean;
  activeTabId: string | null;
  tabSessions: RuntimeSessionConfig[];
  hasActiveTab: boolean;
  mainContent?: ReactNode;
  onResetLayout: () => void;
};

export type PanelRenderContext = {
  shell: ShellPanelContext;
  isEmpty: boolean;
};
