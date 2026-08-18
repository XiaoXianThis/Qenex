import { proxy } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  deleteAisdkSession,
  hibernateAisdkSession,
  invalidateSessionBoot,
  isAisdkSessionId,
} from "../lib/aisdk-session.ts";
import { getBridgeHost } from "../lib/bridge-client.ts";
import {
  hydrateValtioStore,
  subscribeValtioPersist,
} from "../lib/valtio-persist.ts";
import {
  DEFAULT_AGENT_ID,
  agentCommandOverride,
} from "../config/agents.ts";
import { getAgentPreset } from "./agents-store.ts";

export const TABS_PERSIST_KEY = "agent-center-tabs";

const MAX_ACTIVE_TABS = 5;

export type SessionTab = {
  id: string;
  /**
   * Bridge session id (`ses_…`) once bound; placeholder UUID before bootstrap.
   * M4: renamed from fusion `taskId`.
   */
  sessionId: string;
  agentSessionId?: string;
  title: string;
  agentId: string;
  /** Optional override snapshot; empty means Bridge resolves via agentId. */
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
  /** 新建按钮下拉「选项仅切换」：只改偏好、不自动创建；默认 false（选中即创建） */
  skipCreateOnAgentPick: boolean;
};

export const tabsStore = proxy<TabsState>({
  tabs: [],
  activeTabId: null,
  preferredAgentId: DEFAULT_AGENT_ID,
  skipCreateOnAgentPick: false,
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

function deleteSessionInBackground(tab: SessionTab) {
  invalidateSessionBoot(tab.id, tab.cwd, tab.agentId);
  if (!isAisdkSessionId(tab.sessionId)) {
    return;
  }
  void deleteAisdkSession(tab.sessionId, getBridgeHost()).catch((error) => {
    console.warn("Failed to delete Bridge session:", error);
  });
}

function hibernateSessionInBackground(tab: SessionTab) {
  if (!isAisdkSessionId(tab.sessionId)) {
    return;
  }
  void hibernateAisdkSession(tab.sessionId, getBridgeHost()).catch((error) => {
    console.warn("Failed to hibernate Bridge session:", error);
  });
}

/** 有聊天内容则归档进历史，否则直接删除 */
function dismissTab(tabId: string) {
  const tab = tabsStore.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  // 仅明确无聊天内容时丢弃；旧数据缺字段时仍归档
  if (tab.hasChatContent === false) {
    deleteSessionInBackground(tab);
    removeTabLocally(tabId);
    return;
  }

  hibernateSessionInBackground(tab);

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

/** Migrate M1–M3 persisted tabs that still use `taskId`. */
function migrateTab(raw: unknown): SessionTab | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<SessionTab> & { taskId?: string };
  const sessionId =
    (typeof row.sessionId === "string" && row.sessionId) ||
    (typeof row.taskId === "string" && row.taskId) ||
    "";
  if (!row.id || !sessionId) return null;
  const { taskId: _legacyTaskId, ...rest } = row as SessionTab & {
    taskId?: string;
  };
  void _legacyTaskId;
  return {
    ...(rest as SessionTab),
    id: row.id,
    sessionId,
    title: row.title || "新会话",
    agentId: row.agentId || DEFAULT_AGENT_ID,
    agentCommand: Array.isArray(row.agentCommand) ? row.agentCommand : [],
    cwd: row.cwd || ".",
    createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
    lastActiveAt:
      typeof row.lastActiveAt === "number" ? row.lastActiveAt : Date.now(),
    status: row.status === "archived" ? "archived" : "active",
  };
}

export const tabsActions = {
  createTab(config: { agentId: string; cwd: string; title?: string }) {
    const now = Date.now();
    const activeTabs = tabsStore.tabs.filter((t) => t.status === "active");
    const preset = getAgentPreset(config.agentId);

    const newTab: SessionTab = {
      id: crypto.randomUUID(),
      sessionId: `pending:${crypto.randomUUID()}`,
      title: config.title || "新会话",
      agentId: preset.registryId ?? preset.id,
      // Only persist explicit overrides; detect-first presets keep this empty.
      agentCommand: agentCommandOverride(preset.command) ?? [],
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

  setSkipCreateOnAgentPick(skip: boolean) {
    tabsStore.skipCreateOnAgentPick = skip;
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
      deleteSessionInBackground(tab);
    }
    removeTabLocally(tabId);
  },

  /** Update tab workspace; resets Bridge session binding so bootstrap recreates. */
  setTabCwd(tabId: string, cwd: string) {
    const next = cwd.trim();
    if (!next) return;
    const tab = tabsStore.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    invalidateSessionBoot(tabId, tab.cwd, tab.agentId);
    invalidateSessionBoot(tabId, next, tab.agentId);
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId
        ? {
            ...t,
            cwd: next,
            // Force create path (not soft-reuse of previous Bridge session).
            sessionId: `pending:${crypto.randomUUID()}`,
            agentLoading: true,
            hasChatContent: false,
          }
        : t,
    );
  },

  /** Bind Bun Bridge sessionId onto the tab. */
  bindBridgeSession(tabId: string, sessionId: string, title?: string | null) {
    tabsStore.tabs = tabsStore.tabs.map((t) =>
      t.id === tabId
        ? {
            ...t,
            sessionId,
            ...(title && title.trim() ? { title: title.trim() } : {}),
            agentLoading: false,
            needsHistoryLoad: false,
          }
        : t,
    );
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

    const host = getBridgeHost();
    let defaultCwd = (await host.getDefaultWorkspace())?.trim() || "";
    if (!defaultCwd || defaultCwd === ".") {
      defaultCwd = (await host.pickWorkspace())?.trim() || "";
    }
    if (!defaultCwd) {
      // Last resort: relative cwd is resolved by Bridge process — prefer prompting user
      // via pickWorkspace above; only fall back when picker cancelled.
      defaultCwd = ".";
    }

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
  await hydrateValtioStore(TABS_PERSIST_KEY, tabsStore, {
    merge: (persisted, current) => {
      if (!persisted || typeof persisted !== "object") return {};
      const raw = persisted as Partial<TabsState> & {
        tabs?: unknown[];
      };
      const tabs = Array.isArray(raw.tabs)
        ? raw.tabs.map(migrateTab).filter((t): t is SessionTab => t != null)
        : current.tabs;
      return {
        ...raw,
        tabs,
      };
    },
  });
  tabsStore.tabs = tabsStore.tabs.map((t) => {
    const migrated = migrateTab(t) ?? t;
    return {
      ...migrated,
      // Bridge sessions are created/reopened on mount; mark active tabs loading until bind.
      agentLoading: migrated.status === "active",
    };
  });
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
