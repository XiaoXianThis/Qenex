"use client";

import { LAYOUT_EDIT_TOOL_BTN_CLASS } from "@/layout/layoutEditPanel";
import {
  cn,
  parseThemeCss,
  selectActiveThemeCss,
  selectThemeSource,
  STYLE_THEME_PRESET_IDS,
  STYLE_THEME_PRESETS,
  styleActions,
  useHost,
  useStyleStore,
  type StyleThemePresetId,
} from "@qenex/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Code2 } from "lucide-react";
import type { FC } from "react";

const toolBtnClass = LAYOUT_EDIT_TOOL_BTN_CLASS;

type ThemeSelectValue =
  | StyleThemePresetId
  | "custom"
  | "followHost"
  | "followSystem";

function matchThemePreset(css: string): StyleThemePresetId | "custom" {
  const normalized = css.trim();
  for (const id of STYLE_THEME_PRESET_IDS) {
    if (STYLE_THEME_PRESETS[id].css.trim() === normalized) return id;
  }
  return "custom";
}

function themePrimaryColor(id: StyleThemePresetId): string {
  return STYLE_THEME_PRESETS[id].theme.colors.primary;
}

function activePrimaryColor(css: string, value: ThemeSelectValue): string {
  if (value === "followHost" || value === "followSystem") {
    return parseThemeCss(css)["--primary"] ?? "var(--primary)";
  }
  if (value !== "custom") return themePrimaryColor(value);
  return parseThemeCss(css)["--primary"] ?? "var(--primary)";
}

function ThemeSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full border border-border/60"
      style={{ background: color }}
    />
  );
}

/** 布局编辑侧栏中的独立「主题」面板 */
export const LayoutThemePanel: FC = () => {
  const host = useHost();
  const themeCss = useStyleStore(selectActiveThemeCss);
  const themeSource = useStyleStore(selectThemeSource);
  const supportsHostTheme = Boolean(
    host.getHostTheme || host.onHostThemeChange,
  );

  const themeValue: ThemeSelectValue =
    themeSource === "followHost"
      ? "followHost"
      : themeSource === "followSystem"
        ? "followSystem"
        : matchThemePreset(themeCss);
  const currentPrimary = activePrimaryColor(themeCss, themeValue);

  return (
    <>
      <Select
        value={themeValue}
        onValueChange={(value) => {
          if (value === "followHost") {
            styleActions.enableFollowHost();
            void host.getHostTheme?.().then((snapshot) => {
              if (snapshot) styleActions.applyHostTheme(snapshot);
            });
            return;
          }
          if (value === "followSystem") {
            styleActions.enableFollowSystem();
            return;
          }
          if (value === "light" || value === "dark") {
            styleActions.applyThemePreset(value);
          }
        }}
      >
        <SelectTrigger
          className={cn(
            "h-auto w-full min-w-0 rounded-lg border border-primary/10 bg-transparent px-2.5 py-2 text-xs text-primary shadow-none",
            "hover:bg-transparent hover:text-primary dark:bg-transparent dark:hover:bg-transparent",
            "focus-visible:border-primary/10 focus-visible:ring-0",
            "data-[size=default]:h-auto [&_svg]:size-3.5 [&_svg]:text-primary",
          )}
          aria-label="选择主题"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <ThemeSwatch color={currentPrimary} />
            <SelectValue placeholder="主题" />
          </span>
        </SelectTrigger>
        <SelectContent align="start" className="min-w-[8rem]">
          {STYLE_THEME_PRESET_IDS.map((id) => (
            <SelectItem key={id} value={id} className="text-xs">
              <ThemeSwatch color={themePrimaryColor(id)} />
              <SelectItemText>{STYLE_THEME_PRESETS[id].label}</SelectItemText>
            </SelectItem>
          ))}
          {supportsHostTheme ? (
            <SelectItem value="followHost" className="text-xs">
              <ThemeSwatch color={currentPrimary} />
              <SelectItemText>跟随 IDE</SelectItemText>
            </SelectItem>
          ) : null}
          <SelectItem value="followSystem" className="text-xs">
            <ThemeSwatch color={currentPrimary} />
            <SelectItemText>跟随系统</SelectItemText>
          </SelectItem>
          {themeValue === "custom" ? (
            <SelectItem value="custom" disabled className="text-xs">
              <ThemeSwatch color={currentPrimary} />
              <SelectItemText>自定义</SelectItemText>
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={() => styleActions.setEditMode(true)}
        className={cn(
          toolBtnClass,
          "hover:bg-foreground/10 active:bg-foreground/15",
        )}
      >
        <Code2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">CSS 编辑</span>
      </button>
    </>
  );
};
