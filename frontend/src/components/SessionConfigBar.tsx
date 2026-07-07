import { useSessionConfig } from "@/context/SessionConfigContext";
import { hasSelectableOptions } from "@/lib/bridge-api";
import { optionLabel } from "@/lib/session-config";
import { cn } from "@/lib/utils";
import { BrainIcon, CpuIcon, UsersIcon } from "lucide-react";
import type { FC } from "react";

type ConfigSelectProps = {
  label: string;
  icon: FC<{ className?: string }>;
  value: string | null;
  options: Array<{ id: string; name: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
};

function ConfigSelect({
  label,
  icon: Icon,
  value,
  options,
  disabled,
  onChange,
}: ConfigSelectProps) {
  if (options.length === 0) {
    return null;
  }

  const displayValue = optionLabel(options, value);

  if (options.length === 1) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">
          {label}: <span className="text-foreground/80">{displayValue}</span>
        </span>
      </div>
    );
  }

  return (
    <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="shrink-0">{label}</span>
      <select
        className="h-7 min-w-0 max-w-[10rem] truncate rounded-md border bg-background px-2 text-xs text-foreground"
        value={value ?? options[0]?.id ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SessionConfigBar() {
  const { config, changeMode, changeModel, changeThoughtLevel } =
    useSessionConfig();

  const showBar =
    config.ready &&
    (config.modes.length > 0 ||
      config.models.length > 0 ||
      config.thoughtLevels.length > 0);

  if (!showBar && !config.error) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-border/50 px-2.5 py-2",
        config.loading && "opacity-70",
      )}
    >
      {config.error ? (
        <p className="text-xs text-destructive">{config.error}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {hasSelectableOptions(config.modes) || config.modes.length === 1 ? (
          <ConfigSelect
            label="Agent 模式"
            icon={UsersIcon}
            value={config.currentModeId}
            options={config.modes}
            disabled={config.loading || config.modes.length <= 1}
            onChange={(modeId) => {
              void changeMode(modeId);
            }}
          />
        ) : null}

        {hasSelectableOptions(config.models) || config.models.length === 1 ? (
          <ConfigSelect
            label="模型"
            icon={CpuIcon}
            value={config.currentModelId}
            options={config.models}
            disabled={config.loading || config.models.length <= 1}
            onChange={(modelId) => {
              void changeModel(modelId);
            }}
          />
        ) : null}

        {hasSelectableOptions(config.thoughtLevels) ||
        config.thoughtLevels.length === 1 ? (
          <ConfigSelect
            label="思考强度"
            icon={BrainIcon}
            value={config.currentThoughtLevelId}
            options={config.thoughtLevels}
            disabled={config.loading || config.thoughtLevels.length <= 1}
            onChange={(value) => {
              void changeThoughtLevel(value);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
