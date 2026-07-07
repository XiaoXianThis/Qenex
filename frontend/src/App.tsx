import { useEffect, useState, useMemo } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { AgentRuntimeProvider } from "@/components/AgentRuntimeProvider";
import { TabBar } from "@/components/TabBar";
import { HistoryPanel } from "@/components/HistoryPanel";
import { useTabsStore } from "@/store/tabs-store";
import {
  AGENT_PRESETS,
  DEFAULT_AGENT_ID,
  getAgentPreset,
} from "@/config/agents";
import { Archive } from "lucide-react";
import type { SessionConfig } from "@/components/AgentRuntimeProvider";

export default function App() {
  const [showHistory, setShowHistory] = useState(false);
  const [showNewTabDialog, setShowNewTabDialog] = useState(false);
  const [draftAgentId, setDraftAgentId] = useState(DEFAULT_AGENT_ID);
  const [draftCwd, setDraftCwd] = useState(".");

  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const createTab = useTabsStore((s) => s.createTab);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId]
  );

  const archivedCount = useMemo(
    () => tabs.filter((t) => t.status === "archived").length,
    [tabs]
  );

  // Create initial tab if none exist
  useEffect(() => {
    if (tabs.length === 0) {
      createTab({
        agentId: DEFAULT_AGENT_ID,
        cwd: ".",
        title: "会话 1",
      });
    }
  }, []);

  const handleCreateTab = () => {
    createTab({
      agentId: draftAgentId,
      cwd: draftCwd.trim() || ".",
    });
    setShowNewTabDialog(false);
    setShowHistory(false);
  };

  // 为每个活跃 tab 创建并缓存 session config
  const activeTabs = useMemo(
    () => tabs.filter((t) => t.status === "active"),
    [tabs]
  );

  // 预创建所有活跃 tab 的 session，这样切换时不会丢失 runtime
  const tabSessions = useMemo(() => {
    return activeTabs.map(
      (tab): SessionConfig => ({
        tabId: tab.id,
        threadId: tab.taskId,
        cwd: tab.cwd,
        agentCommand: tab.agentCommand,
        agentSessionId: tab.agentSessionId,
        shouldLoadHistory: tab.needsHistoryLoad === true,
      }),
    );
  }, [activeTabs]);

  const activeAgent = activeTab ? getAgentPreset(activeTab.agentId) : null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b bg-card px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Agent Center</h1>
              <p className="text-sm text-muted-foreground">
                assistant-ui + AG-UI → backend-rs（多 Tab 会话管理）
              </p>
            </div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <Archive className="h-4 w-4" />
              历史记录 ({archivedCount})
            </button>
          </div>

          {activeTab && !showHistory && (
            <p className="text-xs text-muted-foreground">
              当前会话：{activeAgent?.name} · cwd={activeTab.cwd} · task=
              {activeTab.taskId.slice(0, 8)}…
            </p>
          )}
        </div>
      </header>

      <TabBar onNewTab={() => setShowNewTabDialog(true)} />

      {showHistory ? (
        <HistoryPanel onRestore={() => setShowHistory(false)} />
      ) : (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4 py-4">
          {/* 渲染所有活跃 tab 的 runtime，但只显示当前激活的 */}
          {tabSessions.map((session) => (
              <div
                key={session.tabId}
                style={{
                  display: session.tabId === activeTabId ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <AgentRuntimeProvider session={session}>
                  <Thread />
                </AgentRuntimeProvider>
              </div>
            ))}

          {!activeTab && (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              点击 + 创建新会话
            </div>
          )}
        </main>
      )}

      {/* New Tab Dialog */}
      {showNewTabDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">创建新会话</h2>

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">ACP Agent</span>
                <select
                  className="h-9 rounded-md border bg-background px-3"
                  value={draftAgentId}
                  onChange={(e) => setDraftAgentId(e.target.value)}
                >
                  {AGENT_PRESETS.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">工作目录 (cwd)</span>
                <input
                  className="h-9 rounded-md border bg-background px-3"
                  value={draftCwd}
                  onChange={(e) => setDraftCwd(e.target.value)}
                  placeholder="."
                />
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreateTab}
                  className="flex-1 h-9 rounded-md bg-primary text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  创建
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewTabDialog(false)}
                  className="flex-1 h-9 rounded-md border text-sm hover:bg-muted transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
