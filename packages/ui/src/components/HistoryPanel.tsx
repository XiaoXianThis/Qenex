import { AgentIcon } from "@/components/AgentIcon";
import { tabsActions, useTabsStore } from "@qenex/core";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";

type HistoryPanelProps = {
  onRestore?: () => void;
};

export function HistoryPanel({ onRestore }: HistoryPanelProps) {
  const allTabs = useTabsStore((s) => s.tabs);
  const restoreTab = tabsActions.restoreTab;
  const deleteTab = tabsActions.deleteTab;

  const archived = useMemo(
    () =>
      allTabs
        .filter((t) => t.status === "archived")
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [allTabs],
  );

  if (archived.length === 0) {
    return (
      <div className="px-2 py-3 text-center text-sm text-muted-foreground">
        暂无历史会话
      </div>
    );
  }

  return (
    <div className="flex max-h-96 flex-col overflow-y-auto" role="listbox">
      {archived.map((tab) => {
        return (
          <div
            key={tab.id}
            className="group relative flex items-center rounded-md focus-within:bg-accent hover:bg-accent"
          >
            <button
              type="button"
              role="option"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-2 pl-2 text-left text-sm outline-none"
              onClick={() => {
                restoreTab(tab.id);
                onRestore?.();
              }}
            >
              <AgentIcon
                agentId={tab.agentId}
                className="h-4 w-4 shrink-0"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
            </button>
            <button
              type="button"
              aria-label={`删除 ${tab.title}`}
              title="删除"
              className="mr-1 shrink-0 cursor-pointer rounded p-1 text-muted-foreground outline-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-destructive focus-visible:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                if (
                  window.confirm(`确定删除「${tab.title}」？此操作不可恢复。`)
                ) {
                  deleteTab(tab.id);
                }
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
