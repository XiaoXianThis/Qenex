import { themeToCss } from "./css-theme.ts";
import { COMPOSER_SHADOW_PRESETS, DEFAULT_THEME } from "./defaults.ts";
import type { ThemeTokens } from "./types.ts";

export type StyleThemePresetId = "light" | "dark";

export type StyleThemePreset = {
  id: StyleThemePresetId;
  label: string;
  theme: ThemeTokens;
  css: string;
};

/** 暗色主题（与现有亮色 token 结构对齐） */
export const DARK_THEME: ThemeTokens = {
  colors: {
    background: "oklch(0.141 0.005 285.823)",
    foreground: "oklch(0.985 0 0)",
    primary: "oklch(0.92 0.004 286.32)",
    primaryForeground: "oklch(0.21 0.006 285.885)",
    muted: "oklch(0.274 0.006 286.033)",
    mutedForeground: "oklch(0.705 0.015 286.067)",
    border: "oklch(1 0 0 / 10%)",
    card: "oklch(0.21 0.006 285.885)",
    destructive: "oklch(0.704 0.191 22.216)",
  },
  radii: {
    base: DEFAULT_THEME.radii.base,
    composer: DEFAULT_THEME.radii.composer,
  },
  shadows: {
    composer: COMPOSER_SHADOW_PRESETS.md,
  },
  sizes: {
    threadMaxWidth: DEFAULT_THEME.sizes.threadMaxWidth,
    composerPadding: DEFAULT_THEME.sizes.composerPadding,
    pagePadding: DEFAULT_THEME.sizes.pagePadding,
  },
  composer: {
    background: "rgb(255 255 255 / 0.05)",
  },
};

export const STYLE_THEME_PRESETS: Record<StyleThemePresetId, StyleThemePreset> =
  {
    light: {
      id: "light",
      label: "亮色",
      theme: DEFAULT_THEME,
      css: themeToCss(DEFAULT_THEME),
    },
    dark: {
      id: "dark",
      label: "暗色",
      theme: DARK_THEME,
      css: themeToCss(DARK_THEME),
    },
  };

export const STYLE_THEME_PRESET_IDS = Object.keys(
  STYLE_THEME_PRESETS,
) as StyleThemePresetId[];
