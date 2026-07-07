import { useTabsStore } from "@/store/tabs-store";
import { getAgentPreset } from "@/config/agents";
import { useMemo } from "react";

type HistoryPanelProps = {
  onRestore?: () => void;
};

export function HistoryPanel({ onRestore }: HistoryPanelProps) {
  const allTabs = useTabsStore((s) => s.tabs);
  const restoreTab = useTabsStore((s) => s.restoreTab);

  const archived = useMemo(
    () =>
      allTabs
        .filter((t) => t.status === "archived")
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [allTabs]
  );

  if (archived.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">暂无历史会话</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-lg font-semibold">历史会话</h2>
      <div className="flex flex-col gap-2">
        {archived.map((tab) => {
          const agent = getAgentPreset(tab.agentId);
          const lastActive = new Date(tab.lastActiveAt);
          return (
            <div
              key={tab.id}
              className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{tab.title}</div>
                <div className="text-sm text-muted-foreground">
                  {agent.name} · {tab.cwd}
                </div>
                <div className="text-xs text-muted-foreground">
                  最后活跃：{lastActive.toLocaleString("zh-CN")}
                </div>
              </div>
              <button
                onClick={() => {
                  restoreTab(tab.id);
                  onRestore?.();
                }}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                恢复
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
