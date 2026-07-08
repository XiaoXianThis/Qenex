import { Archive, Plus, X } from "lucide-react";
import {
  AGENT_PRESETS,
  cn,
  getAgentPreset,
  tabsActions,
  useHost,
  useTabsStore,
} from "@qenex/core";
import { useEffect, useMemo, useRef } from "react";

type TabBarProps = {
  onToggleHistory: () => void;
  showHistory: boolean;
  archivedCount: number;
  position?: "top" | "bottom";
};

export function TabBar({
  onToggleHistory,
  showHistory,
  archivedCount,
  position = "top",
}: TabBarProps) {
  const host = useHost();
  const allTabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const preferredAgentId = useTabsStore((s) => s.preferredAgentId);
  const switchTab = tabsActions.switchTab;
  const closeTab = tabsActions.closeTab;
  const createTab = tabsActions.createTab;
  const setPreferredAgentId = tabsActions.setPreferredAgentId;

  const tabs = useMemo(
    () => allTabs.filter((t) => t.status === "active"),
    [allTabs],
  );

  const tabsScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;

      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const nextScrollLeft = el.scrollLeft + delta;
      const maxScrollLeft = el.scrollWidth - el.clientWidth;

      if (delta < 0 && el.scrollLeft <= 0) return;
      if (delta > 0 && el.scrollLeft >= maxScrollLeft) return;

      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScrollLeft));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handleCreateTab = async () => {
    const cwd = (await host.getDefaultWorkspace()) ?? ".";
    createTab({
      agentId: getAgentPreset(preferredAgentId).id,
      cwd,
    });
    if (showHistory) {
      onToggleHistory();
    }
  };

  return (
    <div
      className={cn(
        "flex items-stretch bg-muted/30",
        position === "top" ? "border-b" : "border-t",
      )}
    >
      <div
        ref={tabsScrollRef}
        className="scroll-x-match flex min-w-0 flex-1 gap-1 px-2"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "flex shrink-0 items-center gap-2 px-3 py-2 text-sm transition-colors",
              position === "top" ? "rounded-t-md" : "rounded-b-md",
              activeTabId === tab.id && !showHistory
                ? "border-x border-t bg-background"
                : "cursor-pointer hover:bg-muted/50",
            )}
            onClick={() => {
              switchTab(tab.id);
              if (showHistory) {
                onToggleHistory();
              }
            }}
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

      <div className="flex shrink-0 items-center gap-1 border-l px-1">
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
          <div className="flex h-8 items-stretch overflow-hidden rounded-md border bg-background shadow-sm">
            <select
              className="h-full min-w-0 max-w-[6.5rem] cursor-pointer border-0 bg-transparent px-2 text-xs outline-none"
              value={preferredAgentId}
              onChange={(e) => setPreferredAgentId(e.target.value)}
              aria-label="选择 Agent"
              title="选择 Agent"
            >
              {AGENT_PRESETS.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleCreateTab()}
              className="flex items-center border-l px-2 transition-colors hover:bg-muted/60"
              aria-label="新建会话"
              title="新建会话"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
