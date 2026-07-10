import { CheckIcon, ChevronDownIcon, KeyRound, type LucideIcon } from "lucide-react";
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
  cn,
} from "@qenex/core";

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
  disabled?: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectThoughtLevel: (value: string) => void;
};

function ModelPicker({
  agentId,
  models,
  currentModelId,
  thoughtLevels,
  currentThoughtLevelId,
  disabled,
  onSelectModel,
  onSelectThoughtLevel,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [thoughtForModelId, setThoughtForModelId] = useState<string | null>(
    null,
  );
  const prefsByAgent = useModelThoughtPrefsStore((s) => s.byAgent);
  const agentPrefs = prefsByAgent[agentId] ?? {};

  if (models.length === 0) {
    return null;
  }

  const selectedModel =
    models.find((model) => model.id === currentModelId) ?? models[0];
  const triggerLabel = modelTriggerLabel(selectedModel?.name ?? "");
  // Agent may omit thought_level for models that don't support it.
  const showThoughtEdit = thoughtLevels.length > 0;
  const selectedThoughtId =
    currentThoughtLevelId ??
    (selectedModel ? agentPrefs[selectedModel.id] : undefined) ??
    thoughtLevels[0]?.id ??
    "";
  const selectedThoughtLabel = showThoughtEdit
    ? (thoughtLevels.find((level) => level.id === selectedThoughtId)?.name ??
      null)
    : null;

  const thoughtIdForModel = (modelId: string): string => {
    if (modelId === selectedModel?.id) {
      return selectedThoughtId;
    }
    return agentPrefs[modelId] ?? thoughtLevels[0]?.id ?? "";
  };

  const thoughtLabelForModel = (modelId: string): string | null => {
    const preferredId = thoughtIdForModel(modelId);
    if (!preferredId) return null;
    return (
      thoughtLevels.find((level) => level.id === preferredId)?.name ??
      preferredId
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setThoughtForModelId(null);
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
            const thoughtLabel = thoughtLabelForModel(model.id);
            const rowThoughtId = thoughtIdForModel(model.id);

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
                  </span>
                </button>

                {showThoughtEdit ? (
                  <Popover
                    open={thoughtOpen}
                    onOpenChange={(next) => {
                      setThoughtForModelId(next ? model.id : null);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`设置 ${model.name} 思考强度`}
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
                      className="w-auto p-2"
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      <div className="mb-1.5 px-0.5 text-[11px] text-muted-foreground">
                        思考强度
                      </div>
                      <ThoughtSegmentBar
                        levels={thoughtLevels}
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
    changeMode,
    changeModel,
    changeThoughtLevel,
    retryAfterAuth,
  } = useSessionConfig();
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
      config.thoughtLevels.length > 0);
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
                  formatLabel={capitalizeEnglishLabel}
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
                  disabled={config.loading}
                  onSelectModel={(modelId) => {
                    void changeModel(modelId);
                  }}
                  onSelectThoughtLevel={(value) => {
                    void changeThoughtLevel(value);
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
        ) : config.error ? (
          <p
            className="max-w-[12rem] shrink truncate text-xs text-destructive"
            title={config.error}
          >
            {config.error}
          </p>
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
