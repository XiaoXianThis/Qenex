import {
  CheckIcon,
  ChevronDownIcon,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  isToggleOptionEnabled,
  oppositeFastOptionId,
  oppositeToggleOptionId,
  displayOptionsForModel,
  hasCachedModelConfigRow,
  modelIdsNeedingConfigPrefetch,
  shouldSkipModelConfigFetch,
  splitThinkingToggleFromCachedOptions,
  triggerOptionsForModel,
  cn,
} from "@qenex/core";
import { Switch } from "@/components/ui/switch";
import { useChatHelpers } from "@/components/ChatHelpersContext";

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
          "h-5.5 max-w-[9rem] min-w-0 shrink-0 items-center border bg-background px-2 py-0 text-xs shadow-none transition-none data-[size=sm]:h-5.5 [&>svg:last-child]:size-3",
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

function ModelNameLabel({ name }: { name: string }) {
  const slash = name.lastIndexOf("/");
  const provider = slash > 0 ? name.slice(0, slash).trim() : "";
  const model = slash > 0 ? name.slice(slash + 1).trim() : "";
  if (!provider || !model) {
    return <span className="min-w-0 truncate">{name}</span>;
  }
  return (
    <span className="min-w-0 truncate">
      <span className="text-muted-foreground/60">{provider}</span>
      <span className="mx-1 text-muted-foreground/60">/</span>
      {model}
    </span>
  );
}

/** Catalog 若已把思考强度编进模型名，就不要再 overlay 同一标签。 */
function overlayThoughtLabel(
  modelName: string,
  thoughtLabel: string | null,
): string | null {
  if (!thoughtLabel?.trim()) return null;
  const name = modelName.toLowerCase();
  const label = thoughtLabel.trim().toLowerCase();
  if (name.includes(label)) return null;
  return thoughtLabel;
}

type ModelOption = { id: string; name: string };
type ThoughtOption = { id: string; name: string };

function looksLikeBooleanToggle(options: ThoughtOption[]): boolean {
  if (options.length === 0 || options.length > 2) return false;
  const off = options.filter((option) => !isToggleOptionEnabled(option.id));
  const on = options.filter((option) => isToggleOptionEnabled(option.id));
  return off.length === 1 && on.length === 1;
}

type ThoughtLevelListProps = {
  levels: ThoughtOption[];
  value: string;
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (value: string) => void;
};

function scrollListToSelected(list: HTMLElement) {
  const selected = list.querySelector<HTMLElement>(
    '[role="option"][aria-selected="true"]',
  );
  const row = selected?.parentElement ?? selected;
  if (!row) return;
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  if (rowRect.height === 0 || list.clientHeight === 0) return;
  const offset =
    rowRect.top -
    listRect.top +
    list.scrollTop -
    (list.clientHeight - rowRect.height) / 2;
  const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
  list.scrollTop = Math.min(maxScroll, Math.max(0, offset));
}

/** Lives inside PopoverContent so layout effect runs after Radix actually mounts the list. */
function ModelPickerList({
  children,
  pausePrefetch,
  uncachedModelIds,
  ensureModelConfigForModel,
}: {
  children: ReactNode;
  pausePrefetch?: boolean;
  uncachedModelIds: readonly string[];
  ensureModelConfigForModel: (modelId: string) => Promise<unknown>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const ensureRef = useRef(ensureModelConfigForModel);
  ensureRef.current = ensureModelConfigForModel;
  const uncachedKey = uncachedModelIds.join("\0");
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Set<string>());

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    scrollListToSelected(list);
    const id = requestAnimationFrame(() => {
      scrollListToSelected(list);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || pausePrefetch) {
      generationRef.current += 1;
      return;
    }
    const generation = ++generationRef.current;
    const uncached = new Set(uncachedKey ? uncachedKey.split("\0") : []);

    const prefetch = (modelId: string) => {
      if (generation !== generationRef.current) return;
      if (!uncached.has(modelId)) return;
      if (inFlightRef.current.has(modelId)) return;
      inFlightRef.current.add(modelId);
      uncached.delete(modelId);
      void ensureRef.current(modelId).finally(() => {
        inFlightRef.current.delete(modelId);
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (generation !== generationRef.current) return;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const modelId = (entry.target as HTMLElement).dataset.modelId;
          if (modelId) prefetch(modelId);
        }
      },
      { root: list, rootMargin: "32px 0px", threshold: 0 },
    );

    for (const row of list.querySelectorAll<HTMLElement>("[data-model-id]")) {
      observer.observe(row);
    }

    return () => {
      generationRef.current += 1;
      observer.disconnect();
    };
  }, [pausePrefetch, uncachedKey]);

  return (
    <div
      ref={listRef}
      className="flex max-h-64 flex-col overflow-y-auto"
      role="listbox"
    >
      {children}
    </div>
  );
}

function ThoughtLevelList({
  levels,
  value,
  disabled,
  ariaLabel = "思考强度",
  onChange,
}: ThoughtLevelListProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex w-full min-w-[10rem] flex-col"
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
              "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            onClick={() => onChange(level.id)}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {selected ? <CheckIcon className="size-3.5" /> : null}
            </span>
            <span className="min-w-0 truncate">{level.name}</span>
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
  contextOptions: ThoughtOption[];
  currentContextId: string | null;
  contextOptionsByModel: Record<string, ThoughtOption[]>;
  thinkingOptions: ThoughtOption[];
  currentThinkingId: string | null;
  thinkingOptionsByModel: Record<string, ThoughtOption[]>;
  ensureModelConfigForModel: (modelId: string) => Promise<{
    thoughtLevels: ThoughtOption[];
    fastOptions: ThoughtOption[];
    contextOptions: ThoughtOption[];
    thinkingOptions: ThoughtOption[];
  }>;
  disabled?: boolean;
  pausePrefetch?: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectThoughtLevel: (value: string) => void;
  onSelectFast: (value: string) => void;
  onSelectContext: (value: string) => void;
  onSelectThinking: (value: string) => void;
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
  contextOptions,
  currentContextId,
  contextOptionsByModel,
  thinkingOptions,
  currentThinkingId,
  thinkingOptionsByModel,
  ensureModelConfigForModel,
  disabled,
  pausePrefetch,
  onSelectModel,
  onSelectThoughtLevel,
  onSelectFast,
  onSelectContext,
  onSelectThinking,
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
  const contextPrefsByAgent = useModelThoughtPrefsStore((s) => s.contextByAgent);
  const thinkingPrefsByAgent = useModelThoughtPrefsStore((s) => s.thinkingByAgent);
  const agentPrefs = prefsByAgent[agentId] ?? {};
  const agentFastPrefs = fastPrefsByAgent[agentId] ?? {};
  const agentContextPrefs = contextPrefsByAgent[agentId] ?? {};
  const agentThinkingPrefs = thinkingPrefsByAgent[agentId] ?? {};

  if (models.length === 0) {
    return null;
  }

  const selectedModel =
    models.find((model) => model.id === currentModelId) ?? models[0];
  const triggerLabel = modelTriggerLabel(selectedModel?.name ?? "");
  const showEdit = models.length > 0;
  const triggerThoughtLevels = triggerOptionsForModel({
    live: thoughtLevels,
    currentModelId,
    byModel: thoughtLevelsByModel,
  });
  const triggerFastOptions = triggerOptionsForModel({
    live: fastOptions,
    currentModelId,
    byModel: fastOptionsByModel,
  });
  const triggerContextOptions = triggerOptionsForModel({
    live: contextOptions,
    currentModelId,
    byModel: contextOptionsByModel,
  });
  const triggerThinkingOptions = triggerOptionsForModel({
    live: thinkingOptions,
    currentModelId,
    byModel: thinkingOptionsByModel,
  });
  const selectedThoughtId =
    currentThoughtLevelId ??
    (selectedModel ? agentPrefs[selectedModel.id] : undefined) ??
    triggerThoughtLevels[0]?.id ??
    "";
  const selectedThoughtLabel = overlayThoughtLabel(
    selectedModel?.name ?? triggerLabel,
    triggerThoughtLevels.find((level) => level.id === selectedThoughtId)
      ?.name ?? null,
  );
  const currentFastEnabled = isFastOptionEnabled(
    currentFastId ??
      (selectedModel ? agentFastPrefs[selectedModel.id] : undefined) ??
      triggerFastOptions[0]?.id,
  );
  const selectedContextId =
    currentContextId ??
    (selectedModel ? agentContextPrefs[selectedModel.id] : undefined) ??
    triggerContextOptions[0]?.id ??
    "";
  const selectedContextLabel =
    triggerContextOptions.find((option) => option.id === selectedContextId)
      ?.name ?? null;
  const currentThinkingEnabled = isToggleOptionEnabled(
    currentThinkingId ??
      (selectedModel ? agentThinkingPrefs[selectedModel.id] : undefined) ??
      triggerThinkingOptions[0]?.id,
  );
  const configMaps = [
    thoughtLevelsByModel,
    fastOptionsByModel,
    contextOptionsByModel,
    thinkingOptionsByModel,
  ];
  const liveHasOptions =
    thoughtLevels.length > 0 ||
    fastOptions.length > 0 ||
    contextOptions.length > 0 ||
    thinkingOptions.length > 0;
  const uncachedModelIds = modelIdsNeedingConfigPrefetch({
    visibleModelIds: models.map((model) => model.id),
    thoughtLevelsByModel,
    fastOptionsByModel,
    contextOptionsByModel,
    thinkingOptionsByModel,
  });
  const currentId = selectedModel?.id ?? currentModelId;

  const optionsForModel = (
    modelId: string,
    live: ThoughtOption[],
    byModel: Record<string, ThoughtOption[]>,
  ): ThoughtOption[] | null => {
    const displayed = displayOptionsForModel({
      modelId,
      currentModelId: currentId,
      live,
      byModel,
    });
    if (displayed !== null) return displayed;
    return hasCachedModelConfigRow(modelId, configMaps) ? [] : null;
  };

  const levelsForModel = (modelId: string): ThoughtOption[] | null =>
    optionsForModel(modelId, thoughtLevels, thoughtLevelsByModel);

  const fastForModel = (modelId: string): ThoughtOption[] | null =>
    optionsForModel(modelId, fastOptions, fastOptionsByModel);

  const contextForModel = (modelId: string): ThoughtOption[] | null =>
    optionsForModel(modelId, contextOptions, contextOptionsByModel);

  const thinkingForModel = (modelId: string): ThoughtOption[] | null =>
    optionsForModel(modelId, thinkingOptions, thinkingOptionsByModel);

  const pickOptionId = (
    modelId: string,
    options: ThoughtOption[],
    currentIdForSelected: string | null,
    prefs: Record<string, string>,
  ): string => {
    if (modelId === selectedModel?.id) {
      return currentIdForSelected ?? options[0]?.id ?? "";
    }
    const preferred = prefs[modelId];
    if (preferred && options.some((option) => option.id === preferred)) {
      return preferred;
    }
    return options[0]?.id ?? "";
  };

  const thoughtIdForModel = (
    modelId: string,
    levels: ThoughtOption[],
  ): string => pickOptionId(modelId, levels, selectedThoughtId, agentPrefs);

  const thoughtLabelForModel = (modelId: string): string | null => {
    const levels = levelsForModel(modelId);
    if (!levels || levels.length === 0) return null;
    const preferredId = thoughtIdForModel(modelId, levels);
    if (!preferredId) return null;
    return levels.find((level) => level.id === preferredId)?.name ?? preferredId;
  };

  const contextLabelForModel = (modelId: string): string | null => {
    const options = contextForModel(modelId);
    if (!options || options.length === 0) return null;
    const id = pickOptionId(
      modelId,
      options,
      selectedContextId,
      agentContextPrefs,
    );
    if (!id) return null;
    return options.find((option) => option.id === id)?.name ?? id;
  };

  const fastIdForModel = (
    modelId: string,
    options: ThoughtOption[],
  ): string => pickOptionId(modelId, options, currentFastId, agentFastPrefs);

  const thinkingIdForModel = (
    modelId: string,
    options: ThoughtOption[],
  ): string => {
    if (modelId === selectedModel?.id) {
      return currentThinkingId ?? options[0]?.id ?? "";
    }
    const preferred = agentThinkingPrefs[modelId];
    if (preferred && options.some((option) => option.id === preferred)) {
      return preferred;
    }
    const thoughtPref = agentPrefs[modelId];
    if (thoughtPref && !isToggleOptionEnabled(thoughtPref)) {
      return (
        options.find((option) => !isToggleOptionEnabled(option.id))?.id ??
        options[0]?.id ??
        ""
      );
    }
    if (thoughtPref && isToggleOptionEnabled(thoughtPref)) {
      return (
        options.find((option) => isToggleOptionEnabled(option.id))?.id ??
        options[0]?.id ??
        ""
      );
    }
    return options[0]?.id ?? "";
  };

  const setToggleForModel = (
    modelId: string,
    options: ThoughtOption[],
    enabled: boolean,
    currentIdValue: string,
    onSelected: (value: string) => void,
    onPref: (modelId: string, value: string) => void,
  ) => {
    const nextId =
      options.find((option) => isFastOptionEnabled(option.id) === enabled)
        ?.id ?? oppositeFastOptionId(options, currentIdValue);
    if (!nextId || nextId === currentIdValue) {
      return;
    }
    if (modelId === selectedModel?.id) {
      onSelected(nextId);
    } else {
      onPref(modelId, nextId);
    }
  };

  const setThinkingEnabledForModel = (
    modelId: string,
    options: ThoughtOption[],
    enabled: boolean,
  ) => {
    const currentValue = thinkingIdForModel(modelId, options);
    if (isToggleOptionEnabled(currentValue) === enabled) {
      return;
    }
    const levels = levelsForModel(modelId) ?? [];
    const nextId = enabled
      ? (thoughtIdForModel(modelId, levels) &&
        isToggleOptionEnabled(thoughtIdForModel(modelId, levels))
          ? thoughtIdForModel(modelId, levels)
          : null) ||
        options.find((option) => isToggleOptionEnabled(option.id))?.id ||
        oppositeToggleOptionId(options, currentValue)
      : options.find((option) => !isToggleOptionEnabled(option.id))?.id ||
        oppositeToggleOptionId(options, currentValue);
    if (!nextId || nextId === currentValue) {
      return;
    }
    if (modelId === selectedModel?.id) {
      onSelectThinking(nextId);
    } else {
      modelThoughtPrefsActions.setThinking(agentId, modelId, nextId);
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
    if (
      shouldSkipModelConfigFetch({
        modelId,
        currentModelId: currentId,
        maps: configMaps,
        liveHasOptions,
      })
    ) {
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
            "flex h-5.5 max-w-[16rem] min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent px-2 py-0 text-xs outline-none transition-none",
            "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          {selectedThoughtLabel &&
          (triggerThinkingOptions.length === 0 || currentThinkingEnabled) ? (
            <span className="shrink-0 text-muted-foreground/60">
              {selectedThoughtLabel}
            </span>
          ) : null}
          {triggerFastOptions.length > 0 && currentFastEnabled ? (
            <span className="shrink-0 text-muted-foreground/60">Fast</span>
          ) : null}
          {selectedContextLabel ? (
            <span className="shrink-0 text-muted-foreground/60">
              {selectedContextLabel}
            </span>
          ) : null}
          {triggerThinkingOptions.length > 0 &&
          currentThinkingEnabled &&
          !selectedThoughtLabel ? (
            <span className="shrink-0 text-muted-foreground/60">思考</span>
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
        <ModelPickerList
          pausePrefetch={pausePrefetch}
          uncachedModelIds={uncachedModelIds}
          ensureModelConfigForModel={ensureModelConfigForModel}
        >
          {models.map((model) => {
            const selected = model.id === selectedModel?.id;
            const thoughtOpen = thoughtForModelId === model.id;
            const rawLevels = levelsForModel(model.id);
            const modelFastOptions = fastForModel(model.id);
            const modelContextOptions = contextForModel(model.id);
            const rawThinking = thinkingForModel(model.id);
            const splitAxes = splitThinkingToggleFromCachedOptions({
              thoughtLevels: rawLevels ?? [],
              thinkingOptions: rawThinking ?? [],
            });
            const modelLevels = rawLevels === null ? null : splitAxes.thoughtLevels;
            const modelThinkingOptions =
              rawThinking === null && rawLevels === null
                ? null
                : splitAxes.thinkingOptions;
            const thoughtLabel = overlayThoughtLabel(
              model.name,
              thoughtLabelForModel(model.id),
            );
            const contextLabel = contextLabelForModel(model.id);
            const rowThoughtId =
              modelLevels && modelLevels.length > 0
                ? thoughtIdForModel(model.id, modelLevels)
                : "";
            const rowFastId =
              modelFastOptions && modelFastOptions.length > 0
                ? fastIdForModel(model.id, modelFastOptions)
                : "";
            const rowContextId =
              modelContextOptions && modelContextOptions.length > 0
                ? pickOptionId(
                    model.id,
                    modelContextOptions,
                    selectedContextId,
                    agentContextPrefs,
                  )
                : "";
            const rowThinkingId =
              modelThinkingOptions && modelThinkingOptions.length > 0
                ? thinkingIdForModel(model.id, modelThinkingOptions)
                : "";
            const thinkingOn = isToggleOptionEnabled(rowThinkingId);
            const probing = probingModelId === model.id;
            const probeError = probeErrorByModel[model.id];
            const loadingConfig =
              probing ||
              (modelLevels === null &&
                modelFastOptions === null &&
                modelContextOptions === null &&
                modelThinkingOptions === null);
            const showModelFast =
              !loadingConfig &&
              !probeError &&
              (modelFastOptions?.length ?? 0) > 0;
            const showModelThinking =
              !loadingConfig &&
              !probeError &&
              (modelThinkingOptions?.length ?? 0) > 0;
            const showModelContext =
              !loadingConfig &&
              !probeError &&
              (modelContextOptions?.length ?? 0) > 0;
            const showModelThought =
              !loadingConfig &&
              !probeError &&
              (modelLevels?.length ?? 0) > 0;
            const hasAnyAxis =
              showModelFast ||
              showModelThinking ||
              showModelContext ||
              showModelThought;

            return (
              <div
                key={model.id}
                data-model-id={model.id}
                className="group relative flex items-center rounded-md focus-within:bg-accent hover:bg-accent"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-2 pl-2 text-left text-xs outline-none"
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
                    <ModelNameLabel name={model.name} />
                    {thoughtLabel &&
                    (!modelThinkingOptions ||
                      modelThinkingOptions.length === 0 ||
                      thinkingOn) ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground/60">
                        {thoughtLabel}
                      </span>
                    ) : null}
                    {modelFastOptions &&
                    modelFastOptions.length > 0 &&
                    isFastOptionEnabled(rowFastId) ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground/60">
                        Fast
                      </span>
                    ) : null}
                    {contextLabel ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground/60">
                        {contextLabel}
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
                      {loadingConfig ? (
                        <div className="text-muted-foreground px-0.5 py-1.5 text-[11px]">
                          正在获取该模型配置…
                        </div>
                      ) : probeError ? (
                        <div className="text-destructive px-0.5 py-1.5 text-[11px]">
                          {probeError}
                        </div>
                      ) : !hasAnyAxis ? (
                        <div className="text-muted-foreground px-0.5 py-1.5 text-[11px]">
                          该模型没有可配置项
                        </div>
                      ) : (
                        <>
                          {showModelThinking && modelThinkingOptions ? (
                            looksLikeBooleanToggle(modelThinkingOptions) ? (
                              <div className="flex items-center justify-between gap-3 px-0.5">
                                <span className="text-[11px] text-muted-foreground">
                                  思考
                                </span>
                                <Switch
                                  checked={thinkingOn}
                                  disabled={disabled}
                                  aria-label="思考开关"
                                  onCheckedChange={(checked) => {
                                    setThinkingEnabledForModel(
                                      model.id,
                                      modelThinkingOptions,
                                      checked,
                                    );
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                <div className="px-0.5 text-[11px] text-muted-foreground">
                                  思考
                                </div>
                                <ThoughtLevelList
                                  ariaLabel="思考开关"
                                  levels={modelThinkingOptions}
                                  value={rowThinkingId}
                                  disabled={disabled}
                                  onChange={(value) => {
                                    if (model.id === selectedModel?.id) {
                                      onSelectThinking(value);
                                    } else {
                                      modelThoughtPrefsActions.setThinking(
                                        agentId,
                                        model.id,
                                        value,
                                      );
                                    }
                                  }}
                                />
                              </div>
                            )
                          ) : null}

                          {showModelThought && modelLevels ? (
                            <div className="space-y-1.5">
                              <div className="px-0.5 text-[11px] text-muted-foreground">
                                思考强度
                              </div>
                              <ThoughtLevelList
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
                            </div>
                          ) : null}

                          {showModelFast && modelFastOptions ? (
                            <div
                              className={cn(
                                "flex items-center justify-between gap-3 px-0.5",
                                (showModelThinking || showModelThought) &&
                                  "border-border border-t pt-2",
                              )}
                            >
                              <span className="text-[11px] text-muted-foreground">
                                Fast
                              </span>
                              <Switch
                                checked={isFastOptionEnabled(rowFastId)}
                                disabled={disabled}
                                aria-label="Fast 模式"
                                onCheckedChange={(checked) => {
                                  setToggleForModel(
                                    model.id,
                                    modelFastOptions,
                                    checked,
                                    rowFastId,
                                    onSelectFast,
                                    (id, value) =>
                                      modelThoughtPrefsActions.setFast(
                                        agentId,
                                        id,
                                        value,
                                      ),
                                  );
                                }}
                              />
                            </div>
                          ) : null}

                          {showModelContext && modelContextOptions ? (
                            <div
                              className={cn(
                                "space-y-1.5",
                                (showModelThinking ||
                                  showModelThought ||
                                  showModelFast) &&
                                  "border-border border-t pt-2",
                              )}
                            >
                              <div className="px-0.5 text-[11px] text-muted-foreground">
                                上下文长度
                              </div>
                              <ThoughtLevelList
                                ariaLabel="上下文长度"
                                levels={modelContextOptions}
                                value={rowContextId}
                                disabled={disabled}
                                onChange={(value) => {
                                  if (model.id === selectedModel?.id) {
                                    onSelectContext(value);
                                  } else {
                                    modelThoughtPrefsActions.setContext(
                                      agentId,
                                      model.id,
                                      value,
                                    );
                                  }
                                  setThoughtForModelId(null);
                                }}
                              />
                            </div>
                          ) : null}
                        </>
                      )}
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            );
          })}
        </ModelPickerList>
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
      <div className="h-5.5 w-[4.5rem] animate-pulse rounded-full bg-foreground/8 dark:bg-foreground/10" />
      <div className="h-5.5 w-28 animate-pulse rounded-full bg-foreground/6 dark:bg-foreground/8" />
    </div>
  );
}

export function SessionConfigBar({ className, trailing }: SessionConfigBarProps) {
  const {
    config,
    agentId,
    thoughtLevelsByModel,
    fastOptionsByModel,
    contextOptionsByModel,
    thinkingOptionsByModel,
    ensureModelConfigForModel,
    changeMode,
    changeModel,
    changeThoughtLevel,
    changeFast,
    changeContext,
    changeThinking,
    retryAfterAuth,
  } = useSessionConfig();
  const chat = useChatHelpers();
  const pausePrefetch =
    config.loading ||
    chat?.status === "submitted" ||
    chat?.status === "streaming";
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (config.authChallenge) {
      setAuthOpen(true);
    }
  }, [config.authChallenge]);

  const showControls =
    config.ready &&
    (config.modes.length > 0 ||
      config.models.length > 0 ||
      config.thoughtLevels.length > 0 ||
      config.fastOptions.length > 0 ||
      config.contextOptions.length > 0 ||
      config.thinkingOptions.length > 0);
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

  return (
    <div
      data-layout-panel="sessionConfigBar"
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1",
        className,
      )}
    >
      <div className="flex min-w-0 items-end gap-2">
        <div className="flex min-w-0 flex-1 items-end gap-x-1 gap-y-1 overflow-x-auto">
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
                  contextOptions={config.contextOptions}
                  currentContextId={config.currentContextId}
                  contextOptionsByModel={contextOptionsByModel}
                  thinkingOptions={config.thinkingOptions}
                  currentThinkingId={config.currentThinkingId}
                  thinkingOptionsByModel={thinkingOptionsByModel}
                  ensureModelConfigForModel={ensureModelConfigForModel}
                  disabled={config.loading}
                  pausePrefetch={pausePrefetch}
                  onSelectModel={(modelId) => {
                    void changeModel(modelId);
                  }}
                  onSelectThoughtLevel={(value) => {
                    void changeThoughtLevel(value);
                  }}
                  onSelectFast={(value) => {
                    void changeFast(value);
                  }}
                  onSelectContext={(value) => {
                    void changeContext(value);
                  }}
                  onSelectThinking={(value) => {
                    void changeThinking(value);
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
        ) : null}

        {trailing ? (
          <div className="flex shrink-0 items-end gap-2.5">{trailing}</div>
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
