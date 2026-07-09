import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import { deleteTask as deleteTaskOnServer } from "../lib/bridge-api.ts";
import { getBridgeHost } from "../lib/bridge-client.ts";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";
import { DEFAULT_AGENT_ID } from "../config/agents.ts";
import { getAgentPreset } from "./agents-store.ts";

export const TABS_PERSIST_KEY = "agent-center-tabs";

const MAX_ACTIVE_TABS = 5;

export type SessionTab = {
  id: string;
  taskId: string;
  agentSessionId?: string;
  title: string;
  agentId: string;
  agentCommand: string[];
  cwd: string;
  createdAt: number;
  lastActiveAt: number;
  status: "active" | "archived";
  needsHistoryLoad?: boolean;
  /** 是否有过聊天内容；无内容关闭时不进入历史 */
  hasChatContent?: boolean;
  /** Agent 启动/加载中，标签显示 Loading */
  agentLoading?: boolean;
};

export type TabsState = {
  tabs: SessionTab[];
  activeTabId: string | null;
  preferredAgentId: string;
};

export const tabsStore = proxy<TabsState>({
  tabs: [],
  activeTabId: null,
  preferredAgentId: DEFAULT_AGENT_ID,
});

function syncPreferredAgentFromActiveTab() {
  const activeTab = tabsStore.tabs.find((t) => t.id === tabsStore.activeTabId);
  if (activeTab) {
    tabsStore.preferredAgentId = getAgentPreset(activeTab.agentId).id;
  }
}

function removeTabLocally(tabId: string) {
  const remaining = tabsStore.tabs.filter((t) => t.id !== tabId);
  const newActiveId =
    tabsStore.activeTabId === tabId
      ? (remaining.find((t) => t.status === "active")?.id ?? null)
      : tabsStore.activeTabId;
  tabsStore.tabs = remaining;
  tabsStore.activeTabId = newActiveId;
  syncPreferredAgentFromActiveTab();
}

function deleteTaskInBackground(taskId: string) {
  void deleteTaskOnServer(taskId).catch((error) => {
    console.warn("Failed to delete task on server:", error);
  });
}

/** 有聊天内容则归档进历史，否则直接删除 */
function dismissTab(tabId: string) {
  const tab = tabsStore.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  // 仅明确无聊天内容时丢弃；旧数据缺字段时仍归档
  if (tab.hasChatContent === false) {
    deleteTaskInBackground(tab.taskId);
    removeTabLocally(tabId);
    return;
  }

  const remaining = tabsStore.tabs.map((t) =>
    t.id === tabId ? { ...t, status: "archived" as const } : t,
  );
  const newActiveId =
    tabsStore.activeTabId === tabId
      ? (remaining.find((t) => t.status === "active")?.id ?? null)
      : tabsStore.activeTabId;
  tabsStore.tabs = remaining;
  tabsStore.activeTabId = newActiveId;
  syncPreferredAgentFromActiveTab();
}

export const tabsActions = {
  createTab(config: { agentId: string; cwd: string; title?: string }) {
    const now = Date.now();
    const activeTabs = tabsStore.tabs.filter((t) => t.status === "active");

    const newTab: SessionTab = {
      id: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      title: config.title || "新会话",
      agentId: config.agentId,
      agentCommand: getAgentPreset(config.agentId).command,
      cwd: config.cwd,
      createdAt: now,
      lastActiveAt: now,
      status: "active",
      hasChatContent: false,
      agentLoading: true,
    };

    if (activeTabs.length >= MAX_ACTIVE_TABS) {
      const oldest = activeTabs.sort(
        (a, b) => a.lastActiveAt - b.lastActiveAt,
      )[0]!;
      dismissTab(oldest.id);
    }

    tabsStore.tabs = [...tabsStore.tabs, newTab];
    tabsStore.activeTabId = newTab.id;
    tabsStore.preferredAgentId = config.agentId;
  },

  setPreferredAgentId(agentId: string) {
    tabsStore.preferredAgentId = getAgentPreset(agentId).id;
  },

  switchTab(tabId: string) {
    tabsStore.activeTabId = tabId;
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId ? { ...t, lastActiveAt: Date.now() } : t,
    );
    syncPreferredAgentFromActiveTab();
  },

  closeTab(tabId: string) {
    dismissTab(tabId);
  },

  restoreTab(tabId: string) {
    const activeTabs = tabsStore.tabs.filter((t) => t.status === "active");
    if (activeTabs.length >= MAX_ACTIVE_TABS) {
      const oldest = activeTabs.sort(
        (a, b) => a.lastActiveAt - b.lastActiveAt,
      )[0]!;
      dismissTab(oldest.id);
    }
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId
        ? {
            ...t,
            status: "active" as const,
            lastActiveAt: Date.now(),
            needsHistoryLoad: true,
            agentLoading: true,
          }
        : t,
    );
    tabsActions.switchTab(tabId);
  },

  deleteTab(tabId: string) {
    const tab = tabsStore.tabs.find((t) => t.id === tabId);
    if (tab) {
      deleteTaskInBackground(tab.taskId);
    }
    removeTabLocally(tabId);
  },

  updateTabTitle(tabId: string, title: string) {
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId ? { ...t, title } : t,
    );
  },

  markTabHasChatContent(tabId: string) {
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId && !t.hasChatContent
        ? { ...t, hasChatContent: true }
        : t,
    );
  },

  setAgentSessionId(tabId: string, agentSessionId: string) {
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId ? { ...t, agentSessionId } : t,
    );
  },

  clearHistoryLoad(tabId: string) {
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId ? { ...t, needsHistoryLoad: false } : t,
    );
  },

  setAgentLoading(tabId: string, loading: boolean) {
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId && t.agentLoading !== loading
        ? { ...t, agentLoading: loading }
        : t,
    );
  },

  async ensureInitialTab(): Promise<void> {
    const activeTabs = tabsStore.tabs.filter((t) => t.status === "active");

    if (activeTabs.length > 0) {
      if (!tabsStore.activeTabId) {
        tabsStore.activeTabId = activeTabs[0]!.id;
      }
      syncPreferredAgentFromActiveTab();
      return;
    }

    const defaultCwd =
      (await getBridgeHost().getDefaultWorkspace()) ?? ".";

    tabsActions.createTab({
      agentId: tabsStore.preferredAgentId,
      cwd: defaultCwd,
    });
  },
};

export function useTabsStore<T>(selector: (state: TabsState) => T): T {
  const snap = useSnapshot(tabsStore) as TabsState;
  return selector(snap);
}

export async function hydrateTabsStore(): Promise<void> {
  await hydrateValtioStore(TABS_PERSIST_KEY, tabsStore);
  tabsStore.tabs = tabsStore.tabs.map((t) => ({
    ...t,
    // 已有 agent session 的视为已就绪；未启动的活跃会话进入加载态
    agentLoading: t.status === "active" && !t.agentSessionId,
  }));
}

let unsubscribeTabsPersist: (() => void) | null = null;

export function startTabsPersist(): () => void {
  unsubscribeTabsPersist?.();
  unsubscribeTabsPersist = subscribeValtioPersist(TABS_PERSIST_KEY, tabsStore);
  return () => {
    unsubscribeTabsPersist?.();
    unsubscribeTabsPersist = null;
  };
}
