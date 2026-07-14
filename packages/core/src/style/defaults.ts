import type { QenexHostKind } from "@qenex/platform";
import { themeToCss, themeToVarMap } from "./css-theme.ts";
import type {
  AllowedStyleVar,
  ComposerShadowPresetId,
  StylePersistedState,
  ThemeSource,
  ThemeTokens,
} from "./types.ts";

/**
 * 首次使用 / 无持久化主题时的默认来源：
 * - IDE 插件 → 跟随 IDE
 * - Web / Desktop → 跟随系统
 * - 其它 → 亮色预设
 */
export function resolveDefaultThemeSource(kind: QenexHostKind): ThemeSource {
  if (kind === "vscode" || kind === "jetbrains") return "followHost";
  if (kind === "web" || kind === "tauri") return "followSystem";
  return "preset";
}

/** 读取系统明暗偏好；不可用时回落 light */
export function getSystemPrefersColorScheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

/** Composer 阴影预设 → CSS 值 */
export const COMPOSER_SHADOW_PRESETS: Record<ComposerShadowPresetId, string> = {
  none: "none",
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
};

export const DEFAULT_THEME: ThemeTokens = {
  colors: {
    background: "#f5f5f5",
    foreground: "oklch(0.141 0.005 285.823)",
    primary: "oklch(0.21 0.006 285.885)",
    primaryForeground: "oklch(0.985 0 0)",
    muted: "oklch(0.967 0.001 286.375)",
    mutedForeground: "oklch(0.552 0.016 285.938)",
    border: "oklch(0.92 0.004 286.32)",
    card: "oklch(1 0 0)",
    destructive: "oklch(0.577 0.245 27.325)",
  },
  radii: {
    base: "0.625rem",
    composer: "1rem",
  },
  shadows: {
    composer: COMPOSER_SHADOW_PRESETS.none,
  },
  sizes: {
    threadMaxWidth: "800px",
    composerPadding: "8px",
    pagePadding: "1.25rem",
  },
  composer: {
    background: "rgb(255 255 255 / 0.3)",
  },
};

export function cloneDefaultTheme(): ThemeTokens {
  return structuredClone(DEFAULT_THEME);
}

/** 默认可编辑 CSS（由 DEFAULT_THEME 生成） */
export const DEFAULT_STYLE_CSS: string = themeToCss(DEFAULT_THEME);

/** 默认白名单变量表（注入缺省补齐用） */
export const DEFAULT_STYLE_VARS: Record<AllowedStyleVar, string> =
  themeToVarMap(DEFAULT_THEME);

export const DEFAULT_CUSTOM_CSS = "";

export function createDefaultStyleState(): StylePersistedState {
  return {
    schemaVersion: 4,
    themeSource: "preset",
    themeCss: DEFAULT_STYLE_CSS,
    customCss: DEFAULT_CUSTOM_CSS,
  };
}

export function composerShadowPresetId(
  value: string,
): ComposerShadowPresetId | null {
  for (const [id, css] of Object.entries(COMPOSER_SHADOW_PRESETS) as [
    ComposerShadowPresetId,
    string,
  ][]) {
    if (css === value) return id;
  }
  return null;
}
