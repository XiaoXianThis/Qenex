import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import { deleteTask as deleteTaskOnServer } from "../lib/bridge-api.ts";
import { getBridgeHost } from "../lib/bridge-client.ts";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";
import { DEFAULT_AGENT_ID, getAgentPreset } from "../config/agents.ts";

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

export const tabsActions = {
  createTab(config: { agentId: string; cwd: string; title?: string }) {
    const now = Date.now();
    const activeTabs = tabsStore.tabs.filter((t) => t.status === "active");
    const nextNum = tabsStore.tabs.length + 1;

    const newTab: SessionTab = {
      id: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      title: config.title || `会话 ${nextNum}`,
      agentId: config.agentId,
      agentCommand: getAgentPreset(config.agentId).command,
      cwd: config.cwd,
      createdAt: now,
      lastActiveAt: now,
      status: "active",
    };

    if (activeTabs.length >= MAX_ACTIVE_TABS) {
      const oldest = activeTabs.sort(
        (a, b) => a.lastActiveAt - b.lastActiveAt,
      )[0]!;
      tabsStore.tabs = tabsStore.tabs.map((t) =>
        t.id === oldest.id ? { ...t, status: "archived" as const } : t,
      );
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
  },

  closeTab(tabId: string) {
    const remaining = tabsStore.tabs.map((t) =>
      t.id === tabId ? { ...t, status: "archived" as const } : t,
    );
    const newActiveId =
      tabsStore.activeTabId === tabId
        ? (remaining.find((t) => t.status === "active")?.id ?? null)
        : tabsStore.activeTabId;
    tabsStore.tabs = remaining;
    tabsStore.activeTabId = newActiveId;
  },

  restoreTab(tabId: string) {
    const activeTabs = tabsStore.tabs.filter((t) => t.status === "active");
    if (activeTabs.length >= MAX_ACTIVE_TABS) {
      const oldest = activeTabs.sort(
        (a, b) => a.lastActiveAt - b.lastActiveAt,
      )[0]!;
      tabsStore.tabs = tabsStore.tabs.map((t) => {
        if (t.id === oldest.id) {
          return { ...t, status: "archived" as const };
        }
        if (t.id === tabId) {
          return {
            ...t,
            status: "active" as const,
            lastActiveAt: Date.now(),
            needsHistoryLoad: true,
          };
        }
        return t;
      });
    } else {
      tabsStore.tabs = tabsStore.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              status: "active" as const,
              lastActiveAt: Date.now(),
              needsHistoryLoad: true,
            }
          : t,
      );
    }
    tabsActions.switchTab(tabId);
  },

  deleteTab(tabId: string) {
    const tab = tabsStore.tabs.find((t) => t.id === tabId);
    if (tab) {
      void deleteTaskOnServer(tab.taskId).catch((error) => {
        console.warn("Failed to delete task on server:", error);
      });
    }

    const remaining = tabsStore.tabs.filter((t) => t.id !== tabId);
    const newActiveId =
      tabsStore.activeTabId === tabId
        ? (remaining.find((t) => t.status === "active")?.id ?? null)
        : tabsStore.activeTabId;
    tabsStore.tabs = remaining;
    tabsStore.activeTabId = newActiveId;
  },

  updateTabTitle(tabId: string, title: string) {
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId ? { ...t, title } : t,
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

  async ensureInitialTab(): Promise<void> {
    const activeTabs = tabsStore.tabs.filter((t) => t.status === "active");

    if (activeTabs.length > 0) {
      if (!tabsStore.activeTabId) {
        tabsStore.activeTabId = activeTabs[0]!.id;
      }
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
