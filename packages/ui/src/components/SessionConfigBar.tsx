import { CheckIcon, ChevronDownIcon, KeyRound, RotateCcw, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AgentAuthDialog } from "@/components/AgentAuthDialog";
import { Button } from "@/components/ui/button";
import { resolveModeIcon } from "@/config/mode-icons";
import {
  useSessionConfig,
  useModelThoughtPrefsStore,
  modelThoughtPrefsActions,
  hasSelectableOptions,
  isFastOptionEnabled,
  oppositeFastOptionId,
  cn,
} from "@qenex/core";
import { Switch } from "@/components/ui/switch";

type ConfigSelectProps = {
  ariaLabel: string;
  value: string | null;
  options: Array<{ id: string; name: string }>;
  disabled?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  itemClassName?: string;
  leadingIcon?: ReactNode;
  resolveOptionIcon?: (option: {
    id: string;
    name: string;
  }) => LucideIcon | null;
  /** 仅影响展示文案；选项 id / 回调仍用原始值 */
  formatLabel?: (name: string) => string;
  onChange: (value: string) => void;
};

function ConfigSelect({
  ariaLabel,
  value,
  options,
  disabled,
  triggerClassName,
  contentClassName,
  itemClassName,
  leadingIcon,
  resolveOptionIcon,
  formatLabel,
  onChange,
}: ConfigSelectProps) {
  if (options.length === 0) {
    return null;
  }

  const selectedValue = value ?? options[0]?.id ?? "";
  const selectedOption =
    options.find((option) => option.id === selectedValue) ?? options[0];
  const triggerLabel =
    formatLabel && selectedOption
      ? formatLabel(selectedOption.name)
      : null;
  const ResolvedTriggerIcon =
    leadingIcon == null && selectedOption && resolveOptionIcon
      ? resolveOptionIcon(selectedOption)
      : null;

  return (
    <Select
      value={selectedValue}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className={cn(
          "h-6 max-w-[9rem] min-w-0 shrink-0 items-center border bg-background px-2 py-0 text-xs shadow-none transition-none data-[size=sm]:h-6 [&>svg:last-child]:size-3",
          triggerClassName,
        )}
      >
        {leadingIcon ? (
          <span className="inline-flex shrink-0 items-center justify-center">
            {leadingIcon}
          </span>
        ) : ResolvedTriggerIcon ? (
          <span className="inline-flex shrink-0 items-center justify-center">
            <ResolvedTriggerIcon className="ml-0.5 mr-0.5 size-3.5 shrink-0 text-muted-foreground" />
          </span>
        ) : null}
        {triggerLabel != null ? (
          <SelectValue className="truncate">{triggerLabel}</SelectValue>
        ) : (
          <SelectValue className="truncate" />
        )}
      </SelectTrigger>
      <SelectContent align="start" className={contentClassName}>
        {options.map((option) => {
          const OptionIcon = resolveOptionIcon?.(option) ?? null;
          return (
            <SelectItem
              key={option.id}
              value={option.id}
              className={itemClassName}
            >
              {OptionIcon ? (
                <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
              <SelectItemText>
                {formatLabel ? formatLabel(option.name) : option.name}
              </SelectItemText>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** 英文名首字母大写（仅展示）；非英文字母开头则原样返回 */
function capitalizeEnglishLabel(name: string): string {
  if (!name) return name;
  const first = name[0]!;
  if (first < "a" || first > "z") return name;
  return first.toUpperCase() + name.slice(1);
}

/** 模式展示名：常见 Cursor / Claude 语义用中文，其余英文首字母大写 */
function formatModeLabel(name: string): string {
  const key = name.trim().toLowerCase().replace(/[_-]+/g, " ");
  const map: Record<string, string> = {
    agent: "Agent",
    ask: "Ask",
    plan: "Plan",
    chat: "Ask",
    code: "Agent",
    build: "Agent",
    act: "执行",
    default: "默认",
    manual: "手动",
    auto: "自动",
    yolo: "YOLO",
    acceptedits: "接受编辑",
    "accept edits": "接受编辑",
    dontask: "勿询问",
    "dont ask": "勿询问",
    bypasspermissions: "绕过权限",
    "bypass permissions": "绕过权限",
    "full access": "完全访问",
    "read only": "只读",
    readonly: "只读",
  };
  if (map[key]) return map[key];
  const compact = key.replace(/\s+/g, "");
  if (map[compact]) return map[compact];
  return capitalizeEnglishLabel(name);
}

/** 「供应商/型号」→ 只保留型号；无斜杠则原样返回 */
function modelTriggerLabel(name: string): string {
  const slash = name.lastIndexOf("/");
  if (slash < 0) return name;
  const model = name.slice(slash + 1).trim();
  return model || name;
}

type ModelOption = { id: string; name: string };
type ThoughtOption = { id: string; name: string };

type ThoughtSegmentBarProps = {
  levels: ThoughtOption[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

function ThoughtSegmentBar({
  levels,
  value,
  disabled,
  onChange,
}: ThoughtSegmentBarProps) {
  return (
    <div
      role="radiogroup"
      aria-label="思考强度"
      className="flex w-full min-w-[16rem] overflow-hidden rounded-md border border-border bg-muted/40 p-0.5"
    >
      {levels.map((level) => {
        const selected = level.id === value;
        return (
          <button
            key={level.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            className={cn(
              "min-w-0 flex-1 cursor-pointer truncate rounded-[5px] px-1.5 py-1.5 text-center text-[11px] outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(level.id)}
          >
            {level.name}
          </button>
        );
      })}
    </div>
  );
}

type ModelPickerProps = {
  agentId: string;
  models: ModelOption[];
  currentModelId: string | null;
  thoughtLevels: ThoughtOption[];
  currentThoughtLevelId: string | null;
  thoughtLevelsByModel: Record<string, ThoughtOption[]>;
  fastOptions: ThoughtOption[];
  currentFastId: string | null;
  fastOptionsByModel: Record<string, ThoughtOption[]>;
  /** Cursor-only silent set_model probes; other agents use session ACP config. */
  usesPerModelConfigProbe: boolean;
  ensureModelConfigForModel: (modelId: string) => Promise<{
    thoughtLevels: ThoughtOption[];
    fastOptions: ThoughtOption[];
  }>;
  disabled?: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectThoughtLevel: (value: string) => void;
  onSelectFast: (value: string) => void;
};

function ModelPicker({
  agentId,
  models,
  currentModelId,
  thoughtLevels,
  currentThoughtLevelId,
  thoughtLevelsByModel,
  fastOptions,
  currentFastId,
  fastOptionsByModel,
  usesPerModelConfigProbe,
  ensureModelConfigForModel,
  disabled,
  onSelectModel,
  onSelectThoughtLevel,
  onSelectFast,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [thoughtForModelId, setThoughtForModelId] = useState<string | null>(
    null,
  );
  const [probingModelId, setProbingModelId] = useState<string | null>(null);
  const [probeErrorByModel, setProbeErrorByModel] = useState<
    Record<string, string>
  >({});
  const prefsByAgent = useModelThoughtPrefsStore((s) => s.byAgent);
  const fastPrefsByAgent = useModelThoughtPrefsStore((s) => s.fastByAgent);
  const agentPrefs = prefsByAgent[agentId] ?? {};
  const agentFastPrefs = fastPrefsByAgent[agentId] ?? {};

  if (models.length === 0) {
    return null;
  }

  const selectedModel =
    models.find((model) => model.id === currentModelId) ?? models[0];
  const triggerLabel = modelTriggerLabel(selectedModel?.name ?? "");
  const anyCachedThought = Object.values(thoughtLevelsByModel).some(
    (levels) => levels.length > 0,
  );
  const anyCachedFast = Object.values(fastOptionsByModel).some(
    (options) => options.length > 0,
  );
  const showEdit =
    thoughtLevels.length > 0 ||
    fastOptions.length > 0 ||
    (usesPerModelConfigProbe &&
      (anyCachedThought || anyCachedFast));
  const selectedThoughtId =
    currentThoughtLevelId ??
    (selectedModel ? agentPrefs[selectedModel.id] : undefined) ??
    thoughtLevels[0]?.id ??
    "";
  const selectedThoughtLabel =
    thoughtLevels.find((level) => level.id === selectedThoughtId)?.name ??
    null;
  const currentFastEnabled = isFastOptionEnabled(currentFastId);

  const levelsForModel = (modelId: string): ThoughtOption[] | null => {
    // Standard ACP: session-level options apply to the live config snapshot.
    if (!usesPerModelConfigProbe) {
      return thoughtLevels;
    }
    if (modelId === selectedModel?.id) {
      return thoughtLevels;
    }
    if (Object.prototype.hasOwnProperty.call(thoughtLevelsByModel, modelId)) {
      return thoughtLevelsByModel[modelId] ?? [];
    }
    return null;
  };

  const fastForModel = (modelId: string): ThoughtOption[] | null => {
    if (!usesPerModelConfigProbe) {
      return fastOptions;
    }
    if (modelId === selectedModel?.id) {
      return fastOptions;
    }
    if (Object.prototype.hasOwnProperty.call(fastOptionsByModel, modelId)) {
      return fastOptionsByModel[modelId] ?? [];
    }
    return null;
  };

  const thoughtIdForModel = (
    modelId: string,
    levels: ThoughtOption[],
  ): string => {
    if (modelId === selectedModel?.id) {
      return selectedThoughtId;
    }
    const preferred = agentPrefs[modelId];
    if (preferred && levels.some((level) => level.id === preferred)) {
      return preferred;
    }
    return levels[0]?.id ?? "";
  };

  const thoughtLabelForModel = (modelId: string): string | null => {
    const levels = levelsForModel(modelId);
    if (!levels || levels.length === 0) return null;
    const preferredId = thoughtIdForModel(modelId, levels);
    if (!preferredId) return null;
    return levels.find((level) => level.id === preferredId)?.name ?? preferredId;
  };

  const fastIdForModel = (
    modelId: string,
    options: ThoughtOption[],
  ): string => {
    if (modelId === selectedModel?.id) {
      return currentFastId ?? options[0]?.id ?? "";
    }
    const preferred = agentFastPrefs[modelId];
    if (preferred && options.some((option) => option.id === preferred)) {
      return preferred;
    }
    return options[0]?.id ?? "";
  };

  const setFastEnabledForModel = (
    modelId: string,
    options: ThoughtOption[],
    enabled: boolean,
  ) => {
    const currentId = fastIdForModel(modelId, options);
    const nextId =
      options.find((option) => isFastOptionEnabled(option.id) === enabled)
        ?.id ?? oppositeFastOptionId(options, currentId);
    if (!nextId || nextId === currentId) {
      return;
    }
    if (modelId === selectedModel?.id) {
      onSelectFast(nextId);
    } else {
      modelThoughtPrefsActions.setFast(agentId, modelId, nextId);
    }
  };

  const openModelEdit = (modelId: string) => {
    setThoughtForModelId(modelId);
    setProbeErrorByModel((current) => {
      if (!current[modelId]) return current;
      const next = { ...current };
      delete next[modelId];
      return next;
    });
    // Non-Cursor: session ACP config is enough — no silent set_model.
    if (!usesPerModelConfigProbe) {
      return;
    }
    // Cached (memory or persist-seeded): show immediately, no spinner.
    if (levelsForModel(modelId) !== null && fastForModel(modelId) !== null) {
      return;
    }
    setProbingModelId(modelId);
    void ensureModelConfigForModel(modelId)
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "获取模型配置失败";
        setProbeErrorByModel((current) => ({
          ...current,
          [modelId]: message,
        }));
      })
      .finally(() => {
        setProbingModelId((current) => (current === modelId ? null : current));
      });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setThoughtForModelId(null);
          setProbingModelId(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="模型"
          className={cn(
            "flex h-6 max-w-[16rem] min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent px-2 py-0 text-xs outline-none transition-none",
            "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          {selectedThoughtLabel ? (
            <span className="shrink-0 text-muted-foreground/60">
              {selectedThoughtLabel}
            </span>
          ) : null}
          {fastOptions.length > 0 && currentFastEnabled ? (
            <span className="shrink-0 text-muted-foreground/60">Fast</span>
          ) : null}
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-auto min-w-[16rem] max-w-[28rem] p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-slot="popover-content"]')) {
            event.preventDefault();
          }
        }}
        onFocusOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-slot="popover-content"]')) {
            event.preventDefault();
          }
        }}
      >
        <div className="flex max-h-64 flex-col overflow-y-auto" role="listbox">
          {models.map((model) => {
            const selected = model.id === selectedModel?.id;
            const thoughtOpen = thoughtForModelId === model.id;
            const modelLevels = levelsForModel(model.id);
            const modelFastOptions = fastForModel(model.id);
            const thoughtLabel = thoughtLabelForModel(model.id);
            const rowThoughtId =
              modelLevels && modelLevels.length > 0
                ? thoughtIdForModel(model.id, modelLevels)
                : "";
            const rowFastId =
              modelFastOptions && modelFastOptions.length > 0
                ? fastIdForModel(model.id, modelFastOptions)
                : "";
            const probing = probingModelId === model.id;
            const probeError = probeErrorByModel[model.id];
            const showModelFast =
              !probing &&
              !probeError &&
              modelFastOptions !== null &&
              modelFastOptions.length > 0;

            return (
              <div
                key={model.id}
                className="group relative flex items-center rounded-md focus-within:bg-accent hover:bg-accent"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-2 pl-2 text-left text-sm outline-none"
                  onClick={() => {
                    onSelectModel(model.id);
                    setThoughtForModelId(null);
                    setOpen(false);
                  }}
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {selected ? <CheckIcon className="size-3.5" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    <span className="min-w-0 truncate">{model.name}</span>
                    {thoughtLabel ? (
                      <span className="shrink-0 text-xs text-muted-foreground/60">
                        {thoughtLabel}
                      </span>
                    ) : null}
                    {modelFastOptions &&
                    modelFastOptions.length > 0 &&
                    isFastOptionEnabled(rowFastId) ? (
                      <span className="shrink-0 text-xs text-muted-foreground/60">
                        Fast
                      </span>
                    ) : null}
                  </span>
                </button>

                {showEdit ? (
                  <Popover
                    open={thoughtOpen}
                    onOpenChange={(next) => {
                      if (next) {
                        openModelEdit(model.id);
                      } else if (thoughtForModelId === model.id) {
                        setThoughtForModelId(null);
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`设置 ${model.name}`}
                        className={cn(
                          "mr-1 shrink-0 cursor-pointer px-1.5 py-0.5 text-xs text-muted-foreground outline-none",
                          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                          "hover:text-foreground focus-visible:opacity-100",
                          thoughtOpen && "text-foreground opacity-100",
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        Edit
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={6}
                      className="w-auto min-w-[12rem] space-y-2 p-2"
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      <div className="space-y-1.5">
                        <div className="px-0.5 text-[11px] text-muted-foreground">
                          思考强度
                        </div>
                        {probing ||
                        modelLevels === null ||
                        modelFastOptions === null ? (
                          <div className="text-muted-foreground px-0.5 py-1.5 text-[11px]">
                            正在获取该模型配置…
                          </div>
                        ) : probeError ? (
                          <div className="text-destructive px-0.5 py-1.5 text-[11px]">
                            {probeError}
                          </div>
                        ) : modelLevels.length > 0 ? (
                          <ThoughtSegmentBar
                            levels={modelLevels}
                            value={rowThoughtId}
                            disabled={disabled}
                            onChange={(value) => {
                              if (model.id === selectedModel?.id) {
                                onSelectThoughtLevel(value);
                              } else {
                                modelThoughtPrefsActions.set(
                                  agentId,
                                  model.id,
                                  value,
                                );
                              }
                              setThoughtForModelId(null);
                            }}
                          />
                        ) : (
                          <div className="text-muted-foreground px-0.5 py-1.5 text-[11px]">
                            该模型不支持思考强度
                          </div>
                        )}
                      </div>

                      {showModelFast ? (
                        <div className="border-border flex items-center justify-between gap-3 border-t px-0.5 pt-2">
                          <span className="text-[11px] text-muted-foreground">
                            Fast
                          </span>
                          <Switch
                            checked={isFastOptionEnabled(rowFastId)}
                            disabled={disabled}
                            aria-label="Fast 模式"
                            onCheckedChange={(checked) => {
                              setFastEnabledForModel(
                                model.id,
                                modelFastOptions,
                                checked,
                              );
                            }}
                          />
                        </div>
                      ) : null}
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SessionConfigBarProps = {
  className?: string;
  trailing?: ReactNode;
};

function SessionConfigSkeleton() {
  return (
    <div
      className="flex items-center gap-x-1.5"
      aria-hidden
      aria-busy="true"
    >
      <div className="h-6 w-[4.5rem] animate-pulse rounded-full bg-foreground/8 dark:bg-foreground/10" />
      <div className="h-6 w-28 animate-pulse rounded-full bg-foreground/6 dark:bg-foreground/8" />
    </div>
  );
}

export function SessionConfigBar({ className, trailing }: SessionConfigBarProps) {
  const {
    config,
    agentId,
    usesPerModelConfigProbe,
    thoughtLevelsByModel,
    fastOptionsByModel,
    ensureModelConfigForModel,
    changeMode,
    changeModel,
    changeThoughtLevel,
    changeFast,
    retryAfterAuth,
  } = useSessionConfig();
  const [authOpen, setAuthOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (config.authChallenge) {
      setAuthOpen(true);
    }
  }, [config.authChallenge]);

  useEffect(() => {
    if (!config.error) {
      setErrorOpen(false);
    }
  }, [config.error]);

  const showControls =
    config.ready &&
    (config.modes.length > 0 ||
      config.models.length > 0 ||
      config.thoughtLevels.length > 0 ||
      config.fastOptions.length > 0);
  const showSkeleton =
    !showControls &&
    !config.error &&
    !config.authChallenge &&
    (config.loading || !config.ready);

  if (
    !showControls &&
    !showSkeleton &&
    !config.error &&
    !config.authChallenge &&
    !trailing
  ) {
    return null;
  }

  const showThoughtFallback =
    config.models.length === 0 &&
    (hasSelectableOptions(config.thoughtLevels) ||
      config.thoughtLevels.length === 1);

  const errorSummary = config.error
    ? config.error.split("\n").find((line) => line.trim())?.trim() ||
      config.error
    : null;

  const handleRetrySpawn = async () => {
    setRetrying(true);
    try {
      await retryAfterAuth();
      setErrorOpen(false);
    } catch {
      // bootstrap already wrote config.error
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      data-layout-panel="sessionConfigBar"
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-x-1 gap-y-1 overflow-x-auto">
          {showSkeleton ? <SessionConfigSkeleton /> : null}

          {showControls ? (
            <>
              {hasSelectableOptions(config.modes) || config.modes.length === 1 ? (
                <ConfigSelect
                  ariaLabel="Agent 模式"
                  value={config.currentModeId}
                  options={config.modes}
                  disabled={config.loading || config.modes.length <= 1}
                  triggerClassName="gap-0.5 rounded-full border-0 bg-foreground/10 data-[size=sm]:rounded-full dark:bg-foreground/10"
                  contentClassName="min-w-[10rem]"
                  itemClassName="py-1.5 text-xs"
                  resolveOptionIcon={resolveModeIcon}
                  formatLabel={formatModeLabel}
                  onChange={(modeId) => {
                    void changeMode(modeId);
                  }}
                />
              ) : null}

              {config.models.length > 0 ? (
                <ModelPicker
                  agentId={agentId}
                  models={config.models}
                  currentModelId={config.currentModelId}
                  thoughtLevels={config.thoughtLevels}
                  currentThoughtLevelId={config.currentThoughtLevelId}
                  thoughtLevelsByModel={thoughtLevelsByModel}
                  fastOptions={config.fastOptions}
                  currentFastId={config.currentFastId}
                  fastOptionsByModel={fastOptionsByModel}
                  usesPerModelConfigProbe={usesPerModelConfigProbe}
                  ensureModelConfigForModel={ensureModelConfigForModel}
                  disabled={config.loading}
                  onSelectModel={(modelId) => {
                    void changeModel(modelId);
                  }}
                  onSelectThoughtLevel={(value) => {
                    void changeThoughtLevel(value);
                  }}
                  onSelectFast={(value) => {
                    void changeFast(value);
                  }}
                />
              ) : null}

              {showThoughtFallback ? (
                <ConfigSelect
                  ariaLabel="思考强度"
                  value={config.currentThoughtLevelId}
                  options={config.thoughtLevels}
                  disabled={config.loading || config.thoughtLevels.length <= 1}
                  triggerClassName="rounded-none border-0 bg-transparent dark:bg-transparent"
                  onChange={(value) => {
                    void changeThoughtLevel(value);
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>

        {config.authChallenge ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1 px-2 text-xs"
            onClick={() => setAuthOpen(true)}
          >
            <KeyRound className="size-3.5" />
            需要登录
          </Button>
        ) : config.error && errorSummary ? (
          <Popover open={errorOpen} onOpenChange={setErrorOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-destructive hover:bg-destructive/10 max-w-[16rem] cursor-pointer truncate rounded px-1.5 py-0.5 text-left text-xs"
                title={config.error}
              >
                {errorSummary}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(28rem,calc(100vw-2rem))] space-y-3 p-3"
            >
              <div className="space-y-1">
                <p className="text-destructive text-sm font-medium">
                  Agent 启动失败
                </p>
                <pre className="bg-muted/60 text-muted-foreground max-h-48 overflow-auto rounded-md p-2 text-[11px] leading-relaxed break-words whitespace-pre-wrap">
                  {config.error}
                </pre>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-xs"
                disabled={retrying || config.loading}
                onClick={() => {
                  void handleRetrySpawn();
                }}
              >
                <RotateCcw className="size-3.5" />
                {retrying ? "重试中…" : "重试"}
              </Button>
            </PopoverContent>
          </Popover>
        ) : null}

        {trailing ? (
          <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
        ) : null}
      </div>

      {config.authChallenge ? (
        <AgentAuthDialog
          open={authOpen}
          onOpenChange={setAuthOpen}
          agentId={agentId}
          challenge={config.authChallenge}
          onRetry={retryAfterAuth}
        />
      ) : null}
    </div>
  );
}
