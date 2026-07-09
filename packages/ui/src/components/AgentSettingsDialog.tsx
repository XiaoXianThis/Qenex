"use client";

import { json } from "@codemirror/lang-json";
import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { getAgentPresetIconUrl } from "@/config/agent-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  agentsActions,
  BUILTIN_TO_REGISTRY_ID,
  cn,
  fetchAgentRegistry,
  formatAgentsConfig,
  installAgentWithProgress,
  parseAgentsConfigJson,
  probeAgent,
  selectActiveThemeCss,
  STYLE_THEME_PRESETS,
  tabsActions,
  uninstallAgent,
  useAgentsStore,
  useStyleStore,
  useTabsStore,
  type AgentPreset,
  type InstallProgressEvent,
  type RegistryAgentEntry,
} from "@qenex/core";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";

const JSON_EDITOR_EXTENSIONS: Extension[] = [json()];

export type AgentSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type AgentAvailability =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; resolved?: string }
  | { status: "unavailable"; detail: string };

type AgentRowStatus = {
  agent: AgentPreset;
  availability: AgentAvailability;
};

type SettingsTab = "registry" | "configured" | "advanced";

type InstallProgressState = {
  message: string;
  stage?: string;
  downloadedBytes?: number;
  totalBytes?: number | null;
  url?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function progressPercent(state: InstallProgressState): number | null {
  if (
    state.totalBytes != null &&
    state.totalBytes > 0 &&
    state.downloadedBytes != null
  ) {
    return Math.min(
      100,
      Math.round((state.downloadedBytes / state.totalBytes) * 100),
    );
  }
  return null;
}

function commandKey(command: string[]): string {
  return JSON.stringify(command);
}

function legacyIdsForRegistry(registryId: string): string[] {
  return Object.entries(BUILTIN_TO_REGISTRY_ID)
    .filter(([, mapped]) => mapped === registryId)
    .map(([builtin]) => builtin);
}

export const AgentSettingsDialog: FC<AgentSettingsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const storeAgents = useAgentsStore((s) => s.agents);
  const defaultAgentId = useAgentsStore((s) => s.defaultAgentId);
  const preferredAgentId = useTabsStore((s) => s.preferredAgentId);
  const themeCss = useStyleStore(selectActiveThemeCss);
  const editorTheme =
    themeCss.trim() === STYLE_THEME_PRESETS.dark.css.trim() ? "dark" : "light";

  const [tab, setTab] = useState<SettingsTab>("registry");
  const [draftText, setDraftText] = useState("");
  const [availabilityById, setAvailabilityById] = useState<
    Record<string, AgentAvailability>
  >({});
  const probeSeqRef = useRef(0);
  const probedCommandsRef = useRef<Record<string, string>>({});

  const [registryAgents, setRegistryAgents] = useState<RegistryAgentEntry[]>(
    [],
  );
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryPlatform, setRegistryPlatform] = useState<string>("");
  const [busyIds, setBusyIds] = useState<Record<string, string>>({});
  const [progressById, setProgressById] = useState<
    Record<string, InstallProgressState>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);

  const validation = useMemo(
    () => parseAgentsConfigJson(draftText || "{}"),
    [draftText],
  );

  const validConfigFingerprint = useMemo(() => {
    if (!validation.ok) return null;
    return JSON.stringify(validation.config);
  }, [validation]);

  const syncDraftFromStore = useCallback(() => {
    setDraftText(formatAgentsConfig(agentsActions.getConfig()));
  }, []);

  const loadRegistry = useCallback(async (refresh = false) => {
    setRegistryLoading(true);
    setRegistryError(null);
    try {
      const response = await fetchAgentRegistry(refresh);
      setRegistryAgents(response.agents);
      setRegistryPlatform(response.platform);
    } catch (error) {
      setRegistryError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRegistryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab("registry");
    syncDraftFromStore();
    probedCommandsRef.current = {};
    setAvailabilityById({});
    setActionError(null);
    void loadRegistry(false);
  }, [open, loadRegistry, syncDraftFromStore]);

  // 有效配置即时写入 store，并校正默认 Agent 选择
  useEffect(() => {
    if (!open || tab !== "advanced" || !validation.ok || !validConfigFingerprint)
      return;
    const current = agentsActions.getConfig();
    const next = validation.config;
    const same =
      current.defaultAgentId === next.defaultAgentId &&
      JSON.stringify(current.agents) === JSON.stringify(next.agents);
    if (!same) {
      agentsActions.setConfig(next);
    }
    if (!next.agents.some((agent) => agent.id === preferredAgentId)) {
      tabsActions.setPreferredAgentId(next.defaultAgentId);
    }
  }, [open, preferredAgentId, tab, validConfigFingerprint, validation]);

  const rows: AgentRowStatus[] = useMemo(() => {
    if (tab === "advanced" && validation.ok) {
      return validation.config.agents.map((agent) => ({
        agent,
        availability: availabilityById[agent.id] ?? { status: "idle" },
      }));
    }
    return storeAgents.map((agent) => ({
      agent: {
        id: agent.id,
        name: agent.name,
        command: [...agent.command],
        source: agent.source,
        registryId: agent.registryId,
      },
      availability: availabilityById[agent.id] ?? { status: "idle" },
    }));
  }, [availabilityById, storeAgents, tab, validation]);

  // 配置有效时探测各 Agent 可执行文件是否可用（防抖）
  useEffect(() => {
    if (!open) return;
    const agents =
      tab === "advanced" && validation.ok
        ? validation.config.agents
        : storeAgents;
    if (agents.length === 0) return;

    const timer = window.setTimeout(() => {
      const toProbe = agents.filter((agent) => {
        const key = commandKey(agent.command);
        return probedCommandsRef.current[agent.id] !== key;
      });
      if (toProbe.length === 0) return;

      const seq = ++probeSeqRef.current;
      setAvailabilityById((prev) => {
        const next = { ...prev };
        for (const agent of toProbe) {
          next[agent.id] = { status: "checking" };
        }
        return next;
      });

      void (async () => {
        const results = await Promise.all(
          toProbe.map(async (agent) => {
            try {
              const result = await probeAgent(agent.command);
              const availability: AgentAvailability = result.available
                ? { status: "available", resolved: result.resolved }
                : {
                    status: "unavailable",
                    detail: result.detail ?? "不可用",
                  };
              return { id: agent.id, availability, command: agent.command };
            } catch (error) {
              return {
                id: agent.id,
                command: agent.command,
                availability: {
                  status: "unavailable" as const,
                  detail:
                    error instanceof Error ? error.message : String(error),
                },
              };
            }
          }),
        );

        if (seq !== probeSeqRef.current) return;

        setAvailabilityById((prev) => {
          const next = { ...prev };
          for (const item of results) {
            const current = agents.find((a) => a.id === item.id);
            if (
              !current ||
              commandKey(current.command) !== commandKey(item.command)
            ) {
              continue;
            }
            probedCommandsRef.current[item.id] = commandKey(item.command);
            next[item.id] = item.availability;
          }
          return next;
        });
      })();
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, storeAgents, tab, validConfigFingerprint, validation]);

  const handleReset = () => {
    agentsActions.resetToDefault();
    syncDraftFromStore();
    setAvailabilityById({});
    probedCommandsRef.current = {};
    const config = agentsActions.getConfig();
    if (!config.agents.some((agent) => agent.id === preferredAgentId)) {
      tabsActions.setPreferredAgentId(config.defaultAgentId);
    }
  };

  const handleInstall = async (entry: RegistryAgentEntry) => {
    setActionError(null);
    setBusyIds((prev) => ({ ...prev, [entry.id]: "install" }));
    setProgressById((prev) => ({
      ...prev,
      [entry.id]: { message: "开始安装…", stage: "start" },
    }));
    try {
      const installed = await installAgentWithProgress(
        entry.id,
        (event: InstallProgressEvent) => {
          if (event.type === "stage") {
            setProgressById((prev) => ({
              ...prev,
              [entry.id]: {
                message: event.message,
                stage: event.stage,
              },
            }));
          } else if (event.type === "download") {
            setProgressById((prev) => ({
              ...prev,
              [entry.id]: {
                message: event.message,
                stage: "download",
                downloadedBytes: event.downloadedBytes,
                totalBytes: event.totalBytes,
                url: event.url,
              },
            }));
          }
        },
      );
      agentsActions.upsertFromRegistry(
        {
          id: installed.agentId,
          name: installed.name || entry.name,
          command: installed.command,
          source: "registry",
          registryId: installed.agentId,
        },
        legacyIdsForRegistry(installed.agentId),
      );
      if (
        legacyIdsForRegistry(installed.agentId).includes(preferredAgentId) ||
        preferredAgentId === installed.agentId
      ) {
        tabsActions.setPreferredAgentId(installed.agentId);
      }
      syncDraftFromStore();
      probedCommandsRef.current = {};
      await loadRegistry(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      setProgressById((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
    }
  };

  const handleUninstall = async (entry: RegistryAgentEntry) => {
    setActionError(null);
    setBusyIds((prev) => ({ ...prev, [entry.id]: "uninstall" }));
    try {
      await uninstallAgent(entry.id);
      try {
        agentsActions.removeAgent(entry.id);
      } catch {
        // Keep at least one agent; ignore if this was the last.
      }
      const config = agentsActions.getConfig();
      if (!config.agents.some((agent) => agent.id === preferredAgentId)) {
        tabsActions.setPreferredAgentId(config.defaultAgentId);
      }
      syncDraftFromStore();
      probedCommandsRef.current = {};
      await loadRegistry(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(92dvh,900px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-4 text-start">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4" />
            Agent 配置
          </DialogTitle>
          <DialogDescription>
            从官方 ACP Registry 安装适配包，或编辑本地 Agent 列表。安装产物托管在
            ~/.qenex。
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 gap-1 border-b border-border px-4 py-2">
          {(
            [
              ["registry", "Registry"],
              ["configured", "已配置"],
              ["advanced", "高级 JSON"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {actionError ? (
          <p className="shrink-0 border-b border-border bg-destructive/5 px-5 py-2 text-xs text-destructive">
            {actionError}
          </p>
        ) : null}

        {tab === "registry" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
              <span className="text-xs text-muted-foreground">
                官方 ACP Registry
                {registryPlatform ? ` · ${registryPlatform}` : ""}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={registryLoading}
                onClick={() => void loadRegistry(true)}
              >
                {registryLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                刷新
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {registryLoading && registryAgents.length === 0 ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  加载 Registry…
                </p>
              ) : registryError ? (
                <p className="px-2 py-8 text-center text-sm text-destructive">
                  {registryError}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {registryAgents.map((entry) => {
                    const busy = busyIds[entry.id];
                    const installed = Boolean(entry.installed);
                    return (
                      <li
                        key={entry.id}
                        className="rounded-lg border border-border bg-muted/30 px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2.5">
                          <img
                            src={getAgentPresetIconUrl(entry.id, entry.icon)}
                            alt=""
                            className="mt-0.5 h-5 w-5 shrink-0 object-contain"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {entry.name}
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {entry.id}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                v{entry.version}
                              </span>
                              {installed ? (
                                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                                  已安装
                                  {entry.installed
                                    ? ` ${entry.installed.version}`
                                    : ""}
                                </span>
                              ) : null}
                              {entry.updateAvailable ? (
                                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                                  可更新
                                </span>
                              ) : null}
                              {!entry.installable ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  当前平台不可装
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                              {entry.description}
                            </p>
                            {entry.preferredKind ? (
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                分发：{entry.preferredKind}
                              </p>
                            ) : null}
                            {busy === "install" && progressById[entry.id] ? (
                              <InstallProgressView
                                state={progressById[entry.id]!}
                              />
                            ) : null}
                          </div>
                          <div className="flex shrink-0 flex-col gap-1">
                            {entry.installable ? (
                              <Button
                                type="button"
                                size="sm"
                                variant={installed ? "outline" : "default"}
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={Boolean(busy)}
                                onClick={() => void handleInstall(entry)}
                              >
                                {busy === "install" ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Download className="size-3.5" />
                                )}
                                {installed
                                  ? entry.updateAvailable
                                    ? "更新"
                                    : "重装"
                                  : "安装"}
                              </Button>
                            ) : null}
                            {installed ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                                disabled={Boolean(busy)}
                                onClick={() => void handleUninstall(entry)}
                              >
                                {busy === "uninstall" ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="size-3.5" />
                                )}
                                卸载
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {tab === "configured" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-border px-4 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                本地已配置 Agent（默认：{defaultAgentId}）
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {rows.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  暂无 Agent，请从 Registry 安装
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rows.map(({ agent, availability }) => {
                    const isDefault = defaultAgentId === agent.id;
                    return (
                      <li
                        key={agent.id}
                        className="rounded-lg border border-border bg-muted/30 px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2.5">
                          <img
                            src={getAgentPresetIconUrl(agent.id)}
                            alt=""
                            className="mt-0.5 h-5 w-5 shrink-0 object-contain"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {agent.name}
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {agent.id}
                              </span>
                              {agent.source ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {agent.source}
                                </span>
                              ) : null}
                              {isDefault ? (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                  默认
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {agent.command.join(" ")}
                            </p>
                            <AvailabilityBadge availability={availability} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {tab === "advanced" ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-2">
            <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-e">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  配置 JSON
                </span>
                {validation.ok ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    有效
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="size-3.5" />
                    无效
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <div className="overflow-hidden rounded-md border border-border">
                  <CodeMirror
                    value={draftText}
                    height="420px"
                    theme={editorTheme}
                    extensions={JSON_EDITOR_EXTENSIONS}
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: true,
                      highlightActiveLine: true,
                      highlightActiveLineGutter: true,
                    }}
                    className="text-[13px] [&_.cm-scroller]:overflow-auto"
                    onChange={setDraftText}
                  />
                </div>
              </div>
              {!validation.ok ? (
                <p className="border-t border-border px-4 py-2 text-xs text-destructive">
                  {validation.error}
                </p>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className="border-b border-border px-4 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  预览
                  {validation.ok
                    ? `（默认：${validation.config.defaultAgentId}）`
                    : ""}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {rows.length === 0 ? (
                  <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                    暂无 Agent
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {rows.map(({ agent, availability }) => (
                      <li
                        key={agent.id}
                        className="rounded-lg border border-border bg-muted/30 px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2.5">
                          <img
                            src={getAgentPresetIconUrl(agent.id)}
                            alt=""
                            className="mt-0.5 h-5 w-5 shrink-0 object-contain"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {agent.name}
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {agent.id}
                              </span>
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {agent.command.join(" ")}
                            </p>
                            <AvailabilityBadge availability={availability} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
          >
            <RotateCcw className="size-3.5" />
            恢复默认
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function InstallProgressView({ state }: { state: InstallProgressState }) {
  const percent = progressPercent(state);
  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-border/80 bg-background/60 px-2.5 py-2">
      <div className="flex items-start gap-1.5 text-[11px] text-foreground">
        <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-muted-foreground" />
        <span className="min-w-0 flex-1 leading-snug">{state.message}</span>
        {percent != null ? (
          <span className="shrink-0 font-mono text-muted-foreground">
            {percent}%
          </span>
        ) : null}
      </div>
      {percent != null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
        </div>
      )}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        {state.stage ? <span>阶段：{state.stage}</span> : null}
        {state.downloadedBytes != null ? (
          <span>
            {formatBytes(state.downloadedBytes)}
            {state.totalBytes != null && state.totalBytes > 0
              ? ` / ${formatBytes(state.totalBytes)}`
              : ""}
          </span>
        ) : null}
        {state.url ? (
          <span className="max-w-full truncate" title={state.url}>
            {state.url}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AvailabilityBadge({
  availability,
}: {
  availability: AgentAvailability;
}) {
  if (availability.status === "idle") {
    return (
      <p className="mt-1.5 text-[11px] text-muted-foreground">等待检测…</p>
    );
  }
  if (availability.status === "checking") {
    return (
      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        检测可用性…
      </p>
    );
  }
  if (availability.status === "available") {
    return (
      <p
        className={cn(
          "mt-1.5 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400",
        )}
        title={availability.resolved}
      >
        <CheckCircle2 className="size-3 shrink-0" />
        可用
        {availability.resolved ? (
          <span className="truncate text-muted-foreground">
            · {availability.resolved}
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <p
      className="mt-1.5 flex items-start gap-1 text-[11px] text-destructive"
      title={availability.detail}
    >
      <AlertCircle className="mt-0.5 size-3 shrink-0" />
      <span className="line-clamp-2">{availability.detail}</span>
    </p>
  );
}
