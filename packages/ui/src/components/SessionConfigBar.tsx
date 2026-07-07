import { useSessionConfig, hasSelectableOptions } from "@qenex/core";
import { cn } from "@qenex/core";
import type { ReactNode } from "react";

type ConfigSelectProps = {
  ariaLabel: string;
  value: string | null;
  options: Array<{ id: string; name: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
};

function ConfigSelect({
  ariaLabel,
  value,
  options,
  disabled,
  onChange,
}: ConfigSelectProps) {
  if (options.length === 0) {
    return null;
  }

  return (
    <select
      aria-label={ariaLabel}
      className="h-7 max-w-[9rem] min-w-0 shrink-0 truncate rounded-md border bg-background px-2 text-xs text-foreground"
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
  );
}

type SessionConfigBarProps = {
  className?: string;
  trailing?: ReactNode;
};

export function SessionConfigBar({ className, trailing }: SessionConfigBarProps) {
  const { config, changeMode, changeModel, changeThoughtLevel } =
    useSessionConfig();

  const showBar =
    config.ready &&
    (config.modes.length > 0 ||
      config.models.length > 0 ||
      config.thoughtLevels.length > 0);

  if (!showBar && !config.error && !trailing) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1",
        config.loading && "opacity-70",
        className,
      )}
    >
      {config.error ? (
        <p className="text-xs text-destructive">{config.error}</p>
      ) : null}

      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-x-3 gap-y-1 overflow-x-auto">
          {hasSelectableOptions(config.modes) || config.modes.length === 1 ? (
            <ConfigSelect
              ariaLabel="Agent 模式"
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
              ariaLabel="模型"
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
              ariaLabel="思考强度"
              value={config.currentThoughtLevelId}
              options={config.thoughtLevels}
              disabled={config.loading || config.thoughtLevels.length <= 1}
              onChange={(value) => {
                void changeThoughtLevel(value);
              }}
            />
          ) : null}
        </div>

        {trailing ? (
          <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
        ) : null}
      </div>
    </div>
  );
}
