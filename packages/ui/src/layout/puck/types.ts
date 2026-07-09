"use client";

import type { RuntimeSessionConfig } from "@qenex/core";
import type { ReactNode } from "react";

export type ShellPanelContext = {
  tabBarPosition: "top" | "bottom";
};

export type LayoutMetadata = {
  shell: ShellPanelContext;
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
