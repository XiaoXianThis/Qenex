import {
  CheckIcon,
  ChevronDownIcon,
  Clock,
  Loader2,
  PaintbrushVertical,
  Settings2,
  X,
} from "lucide-react";
import { getAgentPresetIconUrl } from "@/config/agent-icons";
import { AgentSettingsDialog } from "@/components/AgentSettingsDialog";
import { HistoryPanel } from "@/components/HistoryPanel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  cn,
  getAgentPreset,
  layoutActions,
  tabsActions,
  useAgentsStore,
  useHost,
  useLayoutStore,
  useTabsStore,
} from "@qenex/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type TabBarProps = {
  position?: "top" | "bottom";
};

/** 跨会话切换时 TabBar 可能被重挂载，用模块级变量保留横向滚动位置 */
let savedTabsScrollLeft = 0;

export function TabBar({ position = "top" }: TabBarProps) {
  const host = useHost();
  const allTabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const preferredAgentId = useTabsStore((s) => s.preferredAgentId);
  const switchTab = tabsActions.switchTab;
  const closeTab = tabsActions.closeTab;
  const createTab = tabsActions.createTab;
  const setPreferredAgentId = tabsActions.setPreferredAgentId;
  const editMode = useLayoutStore((s) => s.editMode);
  const setEditMode = layoutActions.setEditMode;
  const agentPresets = useAgentsStore((s) => s.agents);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tabs = useMemo(
    () => allTabs.filter((t) => t.status === "active"),
    [allTabs],
  );

  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const preferredAgent = getAgentPreset(preferredAgentId);

  useLayoutEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    el.scrollLeft = savedTabsScrollLeft;
  }, []);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;

    const persistScroll = () => {
      savedTabsScrollLeft = el.scrollLeft;
    };

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
      persistScroll();
    };

    el.addEventListener("scroll", persistScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      persistScroll();
      el.removeEventListener("scroll", persistScroll);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // 仅在选中标签滚出可视区时轻量滚入，不强制滚到最左
  useLayoutEffect(() => {
    const container = tabsScrollRef.current;
    if (!container || !activeTabId) return;
    const activeEl = container.querySelector<HTMLElement>(
      `[data-tab-id="${activeTabId}"]`,
    );
    if (!activeEl) return;

    const containerRect = container.getBoundingClientRect();
    const tabRect = activeEl.getBoundingClientRect();
    if (tabRect.left < containerRect.left) {
      container.scrollLeft += tabRect.left - containerRect.left - 8;
      savedTabsScrollLeft = container.scrollLeft;
    } else if (tabRect.right > containerRect.right) {
      container.scrollLeft += tabRect.right - containerRect.right + 8;
      savedTabsScrollLeft = container.scrollLeft;
    }
  }, [activeTabId]);

  const tabBarHoverBg = "hover:bg-foreground/10";
  const rightControlClass = "group relative cursor-pointer";
  const rightControlHoverClass =
    "pointer-events-none absolute inset-0 rounded-md bg-transparent group-hover:bg-foreground/10";

  const handleCreateTab = async () => {
    const cwd = (await host.getDefaultWorkspace()) ?? ".";
    createTab({
      agentId: getAgentPreset(preferredAgentId).id,
      cwd,
    });
  };

  return (
    <div className="flex min-w-0 items-center overflow-hidden bg-muted text-foreground py-1.5">
      {!editMode ? (
        <div className="flex shrink-0 items-center pl-2">
          <button
            type="button"
            onClick={() => setEditMode(true)}
            className={cn("rounded-md p-2", rightControlClass)}
            aria-label="编辑布局"
            title="编辑布局"
          >
            <span className={rightControlHoverClass} aria-hidden />
            <PaintbrushVertical className="relative h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div
        ref={tabsScrollRef}
        className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden pe-2 ps-1"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={cn(
              "flex shrink-0 select-none items-center gap-1.5 rounded-full px-2.5 py-1.25 text-[13px]",
              activeTabId === tab.id
                ? "bg-card text-card-foreground"
                : cn("cursor-pointer", tabBarHoverBg),
            )}
            onClick={() => {
              switchTab(tab.id);
            }}
          >
            {tab.agentLoading ? (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                aria-label="加载中"
              />
            ) : (
              <img
                src={getAgentPresetIconUrl(tab.agentId)}
                alt=""
                className="agent-icon-stroke h-3.5 w-3.5 shrink-0 object-contain"
                aria-hidden
              />
            )}
            <span className="max-w-[150px] truncate">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={cn("rounded-full p-0.5", tabBarHoverBg)}
              aria-label="关闭"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 pl-2 pr-2">
        <div
          className={cn(
            "flex items-stretch overflow-hidden rounded-full bg-neutral-900 text-white",
            "hover:bg-neutral-800",
            rightControlClass,
          )}
        >
          <button
            type="button"
            onClick={() => void handleCreateTab()}
            className="relative flex cursor-pointer items-center gap-1.5 py-1.25 pl-3 pr-2 text-[13px] font-medium"
            aria-label={`新建 ${preferredAgent.name} 会话`}
            title={`新建 ${preferredAgent.name} 会话`}
          >
            <img
              src={getAgentPresetIconUrl(preferredAgentId)}
              alt=""
              className="h-3.5 w-3.5 shrink-0 object-contain brightness-0 invert"
              aria-hidden
            />
            <span>新建</span>
          </button>
          <span
            className="relative my-auto h-2.5 w-px shrink-0 bg-white/25"
            aria-hidden
          />
          <Popover open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="relative flex cursor-pointer items-center px-1.5 py-1.25"
                aria-label={`选择 Agent：${preferredAgent.name}`}
                title={`选择 Agent：${preferredAgent.name}`}
              >
                <ChevronDownIcon className="h-3.5 w-3.5 text-white/80" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-auto min-w-[10rem] p-1"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <div className="flex max-h-64 flex-col overflow-y-auto" role="listbox">
                {agentPresets.map((agent) => {
                  const selected = agent.id === preferredAgentId;
                  const looksUninstalled =
                    agent.command[0] === "npx" ||
                    (agent.source === "builtin" &&
                      (agent.id === "claude" || agent.id === "codex"));
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                      onClick={() => {
                        setPreferredAgentId(agent.id);
                        setAgentPickerOpen(false);
                      }}
                    >
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {selected ? <CheckIcon className="size-3.5" /> : null}
                      </span>
                      <img
                        src={getAgentPresetIconUrl(agent.id)}
                        alt=""
                        className="h-4 w-4 shrink-0 object-contain"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                      {looksUninstalled ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          需安装
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => {
                    setAgentPickerOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    <Settings2 className="size-3.5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 truncate">从 Registry 安装…</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={cn("rounded-md p-2", rightControlClass)}
          aria-label="Agent 设置"
          title="Agent 设置"
        >
          <span className={rightControlHoverClass} aria-hidden />
          <Settings2 className="relative h-4 w-4" />
        </button>

        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "rounded-md p-2",
                rightControlClass,
                historyOpen && "bg-background",
              )}
              aria-label="历史记录"
              title="历史记录"
            >
              {!historyOpen && (
                <span className={rightControlHoverClass} aria-hidden />
              )}
              <Clock className="relative h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side={position === "bottom" ? "top" : "bottom"}
            className="w-auto min-w-[16rem] max-w-[28rem] p-1"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <HistoryPanel onRestore={() => setHistoryOpen(false)} />
          </PopoverContent>
        </Popover>
      </div>

      <AgentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
