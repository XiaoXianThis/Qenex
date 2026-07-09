import type { AllowedStyleVar, ThemeTokens } from "./types.ts";
import { ALLOWED_STYLE_VARS } from "./types.ts";

const ALLOWED_SET = new Set<string>(ALLOWED_STYLE_VARS);

/** 每个白名单变量的行尾注释（编辑器里展示） */
export const STYLE_VAR_COMMENTS: Record<AllowedStyleVar, string> = {
  "--background": "页面背景",
  "--foreground": "主文字色",
  "--primary": "主色（按钮等）",
  "--primary-foreground": "主色上的文字",
  "--muted": "弱化背景（TabBar 等）",
  "--muted-foreground": "次要文字",
  "--border": "边框色",
  "--card": "卡片/气泡背景",
  "--card-foreground": "卡片上的文字",
  "--destructive": "危险/错误色",
  "--input": "输入框边框",
  "--popover": "弹出层背景",
  "--popover-foreground": "弹出层文字",
  "--secondary": "次要背景",
  "--secondary-foreground": "次要背景上的文字",
  "--accent": "强调/悬停背景",
  "--accent-foreground": "强调色上的文字",
  "--radius": "基础圆角",
  "--page-padding": "页面边距",
  "--thread-max-width": "对话内容最大宽度",
  "--composer-radius": "输入框圆角",
  "--composer-padding": "输入框内边距",
  "--composer-bg": "输入框背景",
  "--composer-shadow": "输入框阴影",
};

/** ThemeTokens → 白名单 CSS 变量（含派生变量） */
export function themeToVarMap(theme: ThemeTokens): Record<AllowedStyleVar, string> {
  const { colors, radii, shadows, sizes, composer } = theme;
  return {
    "--background": colors.background,
    "--foreground": colors.foreground,
    "--primary": colors.primary,
    "--primary-foreground": colors.primaryForeground,
    "--muted": colors.muted,
    "--muted-foreground": colors.mutedForeground,
    "--border": colors.border,
    "--card": colors.card,
    "--card-foreground": colors.foreground,
    "--destructive": colors.destructive,
    "--input": colors.border,
    "--popover": colors.card,
    "--popover-foreground": colors.foreground,
    "--secondary": colors.muted,
    "--secondary-foreground": colors.foreground,
    "--accent": colors.muted,
    "--accent-foreground": colors.foreground,
    "--radius": radii.base,
    "--page-padding": sizes.pagePadding,
    "--thread-max-width": sizes.threadMaxWidth,
    "--composer-radius": radii.composer,
    "--composer-padding": sizes.composerPadding,
    "--composer-bg": composer.background,
    "--composer-shadow": shadows.composer,
  };
}

/** 面板 / 控件挂点说明（写入默认可编辑 CSS 模板） */
export const STYLE_PANEL_HOOKS_COMMENT = `\
/*
 * 面板级样式：用 [data-layout-panel="<id>"] 定位
 * 可用 id: tabBar | messages | composer | followupSuggestions |
 *   scrollToBottom | welcomeSuggestions | sessionConfigBar |
 *   tokenStats | undoRedo | checklist | approval
 *
 * 布局容器：用 [data-layout-component="<type>"] 定位
 * 可用 type: LayoutRow | LayoutColumn | root.top | root.bottom
 *
 * 示例（取消注释即可生效）：
 *
 * [data-layout-panel="tabBar"] {
 *   background: var(--muted);
 * }
 *
 * [data-layout-panel="composer"] {
 *   --composer-radius: 1.25rem;
 * }
 *
 * [data-layout-panel="messages"] .aui-user-message-content {
 *   border-radius: 1rem;
 * }
 *
 * [data-layout-panel="sessionConfigBar"] {
 *   gap: 0.5rem;
 * }
 *
 * [data-layout-component="LayoutRow"] {
 *   gap: 1rem;
 * }
 */
`;

/** 将主题序列化为可编辑的 `:root { ... }` CSS（每行带注释） */
export function themeToCss(theme: ThemeTokens): string {
  const vars = themeToVarMap(theme);
  const lines = ALLOWED_STYLE_VARS.map(
    (name) => `  ${name}: ${vars[name]}; /* ${STYLE_VAR_COMMENTS[name]} */`,
  );
  return `:root {\n${lines.join("\n")}\n}\n\n${STYLE_PANEL_HOOKS_COMMENT}`;
}

/**
 * 从 CSS 文本提取白名单自定义属性。
 * 只认 `--name: value;`，忽略选择器与其它声明。
 */
export function parseThemeCss(css: string): Partial<Record<AllowedStyleVar, string>> {
  const result: Partial<Record<AllowedStyleVar, string>> = {};
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const name = match[1];
    const value = match[2].trim();
    if (!name || !value) continue;
    if (!ALLOWED_SET.has(name)) continue;
    result[name as AllowedStyleVar] = value;
  }
  return result;
}

/** 以默认变量为底，用解析结果覆盖 */
export function resolveStyleVars(
  css: string,
  defaults: Record<AllowedStyleVar, string>,
): Record<AllowedStyleVar, string> {
  const parsed = parseThemeCss(css);
  return { ...defaults, ...parsed };
}
