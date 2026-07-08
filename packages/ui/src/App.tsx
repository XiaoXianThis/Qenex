import { useMemo, useState } from "react";
import { LayoutShell } from "@/layout/LayoutShell";
import { useTabsStore, type RuntimeSessionConfig } from "@qenex/core";

export default function App() {
  const [showHistory, setShowHistory] = useState(false);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId],
  );

  const archivedCount = useMemo(
    () => tabs.filter((t) => t.status === "archived").length,
    [tabs],
  );

  const activeTabs = useMemo(
    () => tabs.filter((t) => t.status === "active"),
    [tabs],
  );

  const tabSessions = useMemo(() => {
    return activeTabs.map(
      (tab): RuntimeSessionConfig => ({
        tabId: tab.id,
        threadId: tab.taskId,
        cwd: tab.cwd,
        agentCommand: tab.agentCommand,
        agentSessionId: tab.agentSessionId,
        shouldLoadHistory: tab.needsHistoryLoad === true,
      }),
    );
  }, [activeTabs]);

  return (
    <LayoutShell
      showHistory={showHistory}
      onToggleHistory={() => setShowHistory((open) => !open)}
      archivedCount={archivedCount}
      activeTabId={activeTabId}
      tabSessions={tabSessions}
      hasActiveTab={Boolean(activeTab)}
    />
  );
}
