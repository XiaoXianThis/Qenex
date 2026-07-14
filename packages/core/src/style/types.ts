export type ThemeColors = {
  background: string;
  foreground: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  card: string;
  destructive: string;
};

export type ThemeRadii = {
  /** → --radius */
  base: string;
  /** → --composer-radius */
  composer: string;
};

export type ThemeShadows = {
  /** → --composer-shadow */
  composer: string;
};

export type ThemeSizes = {
  /** → --thread-max-width */
  threadMaxWidth: string;
  /** → --composer-padding */
  composerPadding: string;
  /** → --page-padding */
  pagePadding: string;
};

export type ThemeComposer = {
  /** → --composer-bg */
  background: string;
};

export type ThemeTokens = {
  colors: ThemeColors;
  radii: ThemeRadii;
  shadows: ThemeShadows;
  sizes: ThemeSizes;
  composer: ThemeComposer;
};

/** 主题来源：固定预设、跟随 IDE，或跟随系统 prefers-color-scheme */
export type ThemeSource = "preset" | "followHost" | "followSystem";

/** v4：主题来源 + 主题 CSS + 用户自定义 CSS */
export type StylePersistedState = {
  schemaVersion: 4;
  themeSource: ThemeSource;
  themeCss: string;
  customCss: string;
};

/** v3：主题 CSS + 用户自定义 CSS（后者优先级更高，不随主题切换） */
export type StylePersistedStateV3 = {
  schemaVersion: 3;
  themeCss: string;
  customCss: string;
};

/** v2 持久化形态（hydrate 迁移用） */
export type StylePersistedStateV2 = {
  schemaVersion: 2;
  css: string;
};

/** v1 持久化形态（hydrate 迁移用） */
export type StylePersistedStateV1 = {
  schemaVersion: 1;
  theme: ThemeTokens;
};

export type DeepPartialTheme = {
  colors?: Partial<ThemeColors>;
  radii?: Partial<ThemeRadii>;
  shadows?: Partial<ThemeShadows>;
  sizes?: Partial<ThemeSizes>;
  composer?: Partial<ThemeComposer>;
};

export type ComposerShadowPresetId = "none" | "sm" | "md" | "lg";

/** 允许注入到 documentElement 的 CSS 自定义属性 */
export const ALLOWED_STYLE_VARS = [
  "--background",
  "--foreground",
  "--primary",
  "--primary-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--card",
  "--card-foreground",
  "--destructive",
  "--input",
  "--popover",
  "--popover-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--radius",
  "--page-padding",
  "--thread-max-width",
  "--composer-radius",
  "--composer-padding",
  "--composer-bg",
  "--composer-shadow",
] as const;

export type AllowedStyleVar = (typeof ALLOWED_STYLE_VARS)[number];
