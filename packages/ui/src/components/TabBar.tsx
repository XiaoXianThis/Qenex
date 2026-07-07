import { Archive, Plus, X } from "lucide-react";
import { useTabsStore } from "@qenex/core";
import { cn } from "@qenex/core";
import { useMemo } from "react";

type TabBarProps = {
  onNewTab: () => void;
  onToggleHistory: () => void;
  showHistory: boolean;
  archivedCount: number;
};

export function TabBar({
  onNewTab,
  onToggleHistory,
  showHistory,
  archivedCount,
}: TabBarProps) {
  const allTabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const switchTab = useTabsStore((s) => s.switchTab);
  const closeTab = useTabsStore((s) => s.closeTab);

  const tabs = useMemo(
    () => allTabs.filter((t) => t.status === "active"),
    [allTabs],
  );

  return (
    <div className="flex items-stretch border-b bg-muted/30">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-2">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-t-md px-3 py-2 text-sm transition-colors",
              activeTabId === tab.id && !showHistory
                ? "border-x border-t bg-background"
                : "cursor-pointer hover:bg-muted/50",
            )}
            onClick={() => switchTab(tab.id)}
          >
            <span className="max-w-[150px] truncate">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="rounded p-0.5 transition-colors hover:bg-muted"
              aria-label="关闭"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 border-l px-1">
        <button
          type="button"
          onClick={onToggleHistory}
          className={cn(
            "relative rounded-md p-2 transition-colors hover:bg-muted/50",
            showHistory && "bg-background",
          )}
          aria-label={`历史记录${archivedCount > 0 ? `（${archivedCount}）` : ""}`}
          title="历史记录"
        >
          <Archive className="h-4 w-4" />
          {archivedCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {archivedCount > 9 ? "9+" : archivedCount}
            </span>
          ) : null}
        </button>

        {tabs.length < 5 ? (
          <button
            type="button"
            onClick={onNewTab}
            className="rounded-md p-2 transition-colors hover:bg-muted/50"
            aria-label="新建会话"
            title="新建会话"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
