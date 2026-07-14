import type {
  HostThemeColors,
  HostThemeKind,
  HostThemeSnapshot,
} from "@qenex/platform";
import { colorSchemeFromHostThemeKind } from "@qenex/platform";
import {
  STYLE_PANEL_HOOKS_COMMENT,
  STYLE_VAR_COMMENTS,
  themeToVarMap,
} from "./css-theme.ts";
import { cloneDefaultTheme, DEFAULT_THEME } from "./defaults.ts";
import { DARK_THEME } from "./presets.ts";
import type { AllowedStyleVar, ThemeTokens } from "./types.ts";
import { ALLOWED_STYLE_VARS } from "./types.ts";

export { colorSchemeFromHostThemeKind };

function baseThemeForKind(kind: HostThemeKind): ThemeTokens {
  return colorSchemeFromHostThemeKind(kind) === "dark"
    ? structuredClone(DARK_THEME)
    : cloneDefaultTheme();
}

/** 将宿主色合并进亮/暗预设（尺寸/圆角/阴影仍用预设） */
export function mergeHostThemeColors(
  kind: HostThemeKind,
  colors: HostThemeColors,
): ThemeTokens {
  const base = baseThemeForKind(kind);
  const c = base.colors;
  if (colors.background) c.background = colors.background;
  if (colors.foreground) c.foreground = colors.foreground;
  if (colors.muted) c.muted = colors.muted;
  if (colors.mutedForeground) c.mutedForeground = colors.mutedForeground;
  if (colors.border) c.border = colors.border;
  if (colors.card) c.card = colors.card;
  if (colors.primary) c.primary = colors.primary;
  if (colors.primaryForeground) c.primaryForeground = colors.primaryForeground;
  if (colors.destructive) c.destructive = colors.destructive;

  base.composer = {
    background:
      colorSchemeFromHostThemeKind(kind) === "dark"
        ? DARK_THEME.composer.background
        : DEFAULT_THEME.composer.background,
  };

  return base;
}

/**
 * 从 HostThemeColors 补齐派生字段（card/popover/secondary/accent/input）。
 * 宿主只给核心色时调用。
 */
export function expandHostThemeColors(
  colors: HostThemeColors,
): HostThemeColors {
  const foreground = colors.foreground;
  const muted = colors.muted;
  const border = colors.border;
  const card = colors.card ?? colors.background;
  const accent = colors.accent ?? muted;
  const primaryForeground = colors.primaryForeground ?? foreground;

  return {
    ...colors,
    card,
    cardForeground: colors.cardForeground ?? foreground,
    popover: colors.popover ?? card,
    popoverForeground: colors.popoverForeground ?? foreground,
    secondary: colors.secondary ?? muted,
    secondaryForeground: colors.secondaryForeground ?? foreground,
    accent,
    accentForeground: colors.accentForeground ?? foreground,
    input: colors.input ?? border,
    primaryForeground,
  };
}

function hostColorsToVarOverrides(
  colors: HostThemeColors,
): Partial<Record<AllowedStyleVar, string>> {
  const expanded = expandHostThemeColors(colors);
  const out: Partial<Record<AllowedStyleVar, string>> = {};
  const set = (name: AllowedStyleVar, value: string | undefined) => {
    if (value) out[name] = value;
  };
  set("--background", expanded.background);
  set("--foreground", expanded.foreground);
  set("--muted", expanded.muted);
  set("--muted-foreground", expanded.mutedForeground);
  set("--border", expanded.border);
  set("--card", expanded.card);
  set("--card-foreground", expanded.cardForeground);
  set("--primary", expanded.primary);
  set("--primary-foreground", expanded.primaryForeground);
  set("--accent", expanded.accent);
  set("--accent-foreground", expanded.accentForeground);
  set("--destructive", expanded.destructive);
  set("--input", expanded.input);
  set("--secondary", expanded.secondary);
  set("--secondary-foreground", expanded.secondaryForeground);
  set("--popover", expanded.popover);
  set("--popover-foreground", expanded.popoverForeground);
  return out;
}

function varMapToCss(vars: Record<AllowedStyleVar, string>): string {
  const lines = ALLOWED_STYLE_VARS.map(
    (name) => `  ${name}: ${vars[name]}; /* ${STYLE_VAR_COMMENTS[name]} */`,
  );
  return `:root {\n${lines.join("\n")}\n}\n\n${STYLE_PANEL_HOOKS_COMMENT}`;
}

/** HostThemeSnapshot → 可注入的 themeCss（含 accent/secondary 等派生覆盖） */
export function mapHostThemeToCss(snapshot: HostThemeSnapshot): string {
  const theme = mergeHostThemeColors(snapshot.kind, snapshot.colors);
  const vars = {
    ...themeToVarMap(theme),
    ...hostColorsToVarOverrides(snapshot.colors),
  };
  return varMapToCss(vars);
}

/** @deprecated 使用 mapHostThemeToCss（内部已 expand） */
export function mapHostThemeToCssExpanded(
  snapshot: HostThemeSnapshot,
): string {
  return mapHostThemeToCss(snapshot);
}
