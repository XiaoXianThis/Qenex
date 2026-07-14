import {
  CheckIcon,
  ChevronDownIcon,
  Clock,
  Loader2,
  PaintbrushVertical,
  Settings2,
  X,
} from "lucide-react";
import { AgentIcon } from "@/components/AgentIcon";
import { AgentSettingsDialog } from "@/components/AgentSettingsDialog";
import { HistoryPanel } from "@/components/HistoryPanel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  agentsActions,
  BUILTIN_TO_REGISTRY_ID,
  cn,
  ensureAgentReadyWithProgress,
  fetchAgentRegistry,
  getAgentPreset,
  layoutActions,
  legacyIdsForRegistry,
  resolveAgentBridgeId,
  tabsActions,
  useAgentsStore,
  useHost,
  useLayoutStore,
  useTabsStore,
  type AgentReadiness,
  type InstallProgressEvent,
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
  const skipCreateOnAgentPick = useTabsStore((s) => s.skipCreateOnAgentPick);
  const switchTab = tabsActions.switchTab;
  const closeTab = tabsActions.closeTab;
  const createTab = tabsActions.createTab;
  const setPreferredAgentId = tabsActions.setPreferredAgentId;
  const setSkipCreateOnAgentPick = tabsActions.setSkipCreateOnAgentPick;
  const editMode = useLayoutStore((s) => s.editMode);
  const setEditMode = layoutActions.setEditMode;
  const agentPresets = useAgentsStore((s) => s.agents);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readinessById, setReadinessById] = useState<
    Record<string, AgentReadiness>
  >({});
  const [ensuring, setEnsuring] = useState(false);
  const [ensureMessage, setEnsureMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAgentRegistry(false)
      .then((res) => {
        if (cancelled) return;
        const next: Record<string, AgentReadiness> = {};
        for (const entry of res.agents) {
          if (entry.readiness) {
            next[entry.id] = entry.readiness;
          }
        }
        setReadinessById(next);
      })
      .catch(() => {
        // TabBar hint is best-effort; ignore registry failures.
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, agentPresets]);

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

  const handleCreateTab = async (agentId = preferredAgentId) => {
    const preset = getAgentPreset(agentId);
    const bridgeId = resolveAgentBridgeId(preset);
    const readiness = readinessById[bridgeId];
    const needsEnsure =
      readiness !== undefined &&
      readiness !== "ready" &&
      readiness !== "needAuth";

    if (needsEnsure) {
      setEnsuring(true);
      setEnsureMessage("准备 Agent…");
      try {
        const result = await ensureAgentReadyWithProgress(
          bridgeId,
          undefined,
          (event: InstallProgressEvent) => {
            if (event.type === "stage" || event.type === "download") {
              setEnsureMessage(event.message);
            }
          },
        );
        agentsActions.upsertFromRegistry(
          {
            id: result.agentId,
            name: preset.name || result.agentId,
            command: [],
            source: result.skippedDownload ? "detected" : "registry",
            registryId: result.agentId,
          },
          legacyIdsForRegistry(result.agentId),
        );
        setReadinessById((prev) => ({
          ...prev,
          [result.agentId]: result.readiness,
        }));
      } catch (error) {
        setEnsureMessage(
          error instanceof Error ? error.message : "Agent 准备失败",
        );
        setEnsuring(false);
        return;
      } finally {
        setEnsuring(false);
        setEnsureMessage(null);
      }
    }

    const cwd = (await host.getDefaultWorkspace()) ?? ".";
    createTab({
      agentId: preset.id,
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
            onMouseDown={(e) => {
              // 中键默认会触发自动滚动，需在 mousedown 阶段拦截
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            {tab.agentLoading ? (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                aria-label="加载中"
              />
            ) : (
              <AgentIcon
                agentId={tab.agentId}
                className="agent-icon-stroke h-3.5 w-3.5 shrink-0"
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
            disabled={ensuring}
            className="relative flex cursor-pointer items-center gap-1.5 py-1.25 pl-3 pr-2 text-[13px] font-medium disabled:cursor-wait disabled:opacity-80"
            aria-label={
              ensuring
                ? (ensureMessage ?? "准备 Agent…")
                : `新建 ${preferredAgent.name} 会话`
            }
            title={
              ensuring
                ? (ensureMessage ?? "准备 Agent…")
                : `新建 ${preferredAgent.name} 会话`
            }
          >
            {ensuring ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <span className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px]">
                <AgentIcon
                  agentId={preferredAgentId}
                  ink="contrast"
                  className="h-3 w-3"
                  aria-hidden
                />
              </span>
            )}
            <span>{ensuring ? "准备中" : "新建"}</span>
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
              <div className="flex max-h-[60vh] flex-col">
                <div className="flex shrink-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate">选项仅切换</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={skipCreateOnAgentPick}
                    aria-label="选项仅切换"
                    className={cn(
                      "relative h-5 w-8 shrink-0 cursor-pointer rounded-full transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                      skipCreateOnAgentPick ? "bg-primary" : "bg-input",
                    )}
                    onClick={() =>
                      setSkipCreateOnAgentPick(!skipCreateOnAgentPick)
                    }
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow transition-transform",
                        skipCreateOnAgentPick && "translate-x-3",
                      )}
                      aria-hidden
                    />
                  </button>
                </div>
                <div className="my-1 shrink-0 border-t border-border" />
                <div className="min-h-0 flex-1 overflow-y-auto" role="listbox">
                  {agentPresets.map((agent) => {
                    const selected = agent.id === preferredAgentId;
                    const registryId =
                      agent.registryId ??
                      BUILTIN_TO_REGISTRY_ID[agent.id] ??
                      agent.id;
                    const readiness = readinessById[registryId];
                    const needsAction =
                      readiness !== undefined &&
                      readiness !== "ready" &&
                      readiness !== "needAuth";
                    const hint =
                      readiness === "needAdapter"
                        ? "需适配层"
                        : readiness === "needAuth"
                          ? "需登录"
                          : readiness === "install"
                            ? "需安装"
                            : readiness === "unavailable"
                              ? "不可用"
                              : null;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                        onClick={() => {
                          setPreferredAgentId(agent.id);
                          setAgentPickerOpen(false);
                          if (!skipCreateOnAgentPick) {
                            void handleCreateTab(agent.id);
                          }
                        }}
                      >
                        <span className="flex size-3.5 shrink-0 items-center justify-center">
                          {selected ? <CheckIcon className="size-3.5" /> : null}
                        </span>
                        <AgentIcon
                          agentId={agent.id}
                          className="h-4 w-4 shrink-0"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {agent.name}
                        </span>
                        {needsAction && hint ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {hint}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
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
