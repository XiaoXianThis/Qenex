import { X, Plus } from "lucide-react";
import { useTabsStore } from "@/store/tabs-store";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

type TabBarProps = {
  onNewTab: () => void;
};

export function TabBar({ onNewTab }: TabBarProps) {
  const allTabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const switchTab = useTabsStore((s) => s.switchTab);
  const closeTab = useTabsStore((s) => s.closeTab);

  const tabs = useMemo(
    () => allTabs.filter((t) => t.status === "active"),
    [allTabs]
  );

  return (
    <div className="flex gap-1 overflow-x-auto border-b bg-muted/30 px-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "flex items-center gap-2 rounded-t-md px-3 py-2 text-sm transition-colors",
            activeTabId === tab.id
              ? "bg-background border-x border-t"
              : "hover:bg-muted/50 cursor-pointer"
          )}
          onClick={() => switchTab(tab.id)}
        >
          <span className="max-w-[150px] truncate">{tab.title}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
            className="hover:bg-muted rounded p-0.5 transition-colors"
            aria-label="关闭"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {tabs.length < 5 && (
        <button
          onClick={onNewTab}
          className="px-3 py-2 text-sm hover:bg-muted/50 rounded-t-md transition-colors"
          aria-label="新建会话"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
