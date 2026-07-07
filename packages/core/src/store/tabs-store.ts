import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { deleteTask as deleteTaskOnServer } from "../lib/bridge-api.ts";
import { getBridgeHost } from "../lib/bridge-client.ts";
import { getHostPersistStorage } from "../lib/host-storage.ts";
import { DEFAULT_AGENT_ID, getAgentPreset } from "../config/agents.ts";

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

type TabsState = {
  tabs: SessionTab[];
  activeTabId: string | null;
};

type TabsActions = {
  createTab: (config: {
    agentId: string;
    cwd: string;
    title?: string;
  }) => void;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  restoreTab: (tabId: string) => void;
  deleteTab: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  setAgentSessionId: (tabId: string, agentSessionId: string) => void;
  clearHistoryLoad: (tabId: string) => void;
  ensureInitialTab: () => Promise<void>;
};

export const useTabsStore = create<TabsState & TabsActions>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      createTab: (config) => {
        const now = Date.now();
        const activeTabs = get().tabs.filter((t) => t.status === "active");
        const nextNum = get().tabs.length + 1;

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
          )[0];
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === oldest.id ? { ...t, status: "archived" as const } : t,
            ),
          }));
        }

        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        }));
      },

      switchTab: (tabId) => {
        set((state) => ({
          activeTabId: tabId,
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, lastActiveAt: Date.now() } : t,
          ),
        }));
      },

      closeTab: (tabId) => {
        set((state) => {
          const remaining = state.tabs.map((t) =>
            t.id === tabId ? { ...t, status: "archived" as const } : t,
          );
          const newActiveId =
            state.activeTabId === tabId
              ? remaining.find((t) => t.status === "active")?.id || null
              : state.activeTabId;
          return { tabs: remaining, activeTabId: newActiveId };
        });
      },

      restoreTab: (tabId) => {
        const activeTabs = get().tabs.filter((t) => t.status === "active");
        if (activeTabs.length >= MAX_ACTIVE_TABS) {
          const oldest = activeTabs.sort(
            (a, b) => a.lastActiveAt - b.lastActiveAt,
          )[0];
          set((state) => ({
            tabs: state.tabs.map((t) => {
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
            }),
          }));
        } else {
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === tabId
                ? {
                    ...t,
                    status: "active" as const,
                    lastActiveAt: Date.now(),
                    needsHistoryLoad: true,
                  }
                : t,
            ),
          }));
        }
        get().switchTab(tabId);
      },

      deleteTab: (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        if (tab) {
          void deleteTaskOnServer(tab.taskId).catch((error) => {
            console.warn("Failed to delete task on server:", error);
          });
        }

        set((state) => {
          const remaining = state.tabs.filter((t) => t.id !== tabId);
          const newActiveId =
            state.activeTabId === tabId
              ? (remaining.find((t) => t.status === "active")?.id ?? null)
              : state.activeTabId;
          return { tabs: remaining, activeTabId: newActiveId };
        });
      },

      updateTabTitle: (tabId, title) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
        }));
      },

      setAgentSessionId: (tabId, agentSessionId) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, agentSessionId } : t,
          ),
        }));
      },

      clearHistoryLoad: (tabId) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, needsHistoryLoad: false } : t,
          ),
        }));
      },

      ensureInitialTab: async () => {
        const state = get();
        const activeTabs = state.tabs.filter((t) => t.status === "active");

        if (activeTabs.length > 0) {
          if (!state.activeTabId) {
            set({ activeTabId: activeTabs[0]!.id });
          }
          return;
        }

        const defaultCwd =
          (await getBridgeHost().getDefaultWorkspace()) ?? ".";

        get().createTab({
          agentId: DEFAULT_AGENT_ID,
          cwd: defaultCwd,
        });
      },
    }),
    {
      name: "agent-center-tabs",
      storage: createJSONStorage(() => getHostPersistStorage()),
      skipHydration: true,
    },
  ),
);
