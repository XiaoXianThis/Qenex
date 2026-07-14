/**
 * 从 VS Code webview 注入的 `--vscode-*` CSS 变量采样表面色。
 * 扩展侧无法直接读主题色值；webview 内这些变量由 VS Code 自动注入。
 */
import type { HostThemeColors, HostThemeKind, HostThemeSnapshot } from "@qenex/platform";

const VSCODE_COLOR_MAP: Array<[keyof HostThemeColors, string]> = [
  ["background", "--vscode-sideBar-background"],
  ["foreground", "--vscode-foreground"],
  ["muted", "--vscode-editor-background"],
  ["mutedForeground", "--vscode-descriptionForeground"],
  ["border", "--vscode-panel-border"],
  ["input", "--vscode-input-border"],
  ["card", "--vscode-editorWidget-background"],
  ["popover", "--vscode-dropdown-background"],
  ["primary", "--vscode-button-background"],
  ["primaryForeground", "--vscode-button-foreground"],
  ["accent", "--vscode-list-hoverBackground"],
  ["accentForeground", "--vscode-list-activeSelectionForeground"],
  ["secondary", "--vscode-input-background"],
  ["secondaryForeground", "--vscode-input-foreground"],
  ["destructive", "--vscode-errorForeground"],
];

function readCssVar(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || undefined;
}

export function sampleVscodeThemeColors(): HostThemeColors {
  const colors: HostThemeColors = {};
  for (const [key, cssVar] of VSCODE_COLOR_MAP) {
    const value = readCssVar(cssVar);
    if (value) colors[key] = value;
  }
  // 侧栏不可用时回退编辑器背景
  if (!colors.background) {
    const editorBg = readCssVar("--vscode-editor-background");
    if (editorBg) colors.background = editorBg;
  }
  if (!colors.cardForeground && colors.foreground) {
    colors.cardForeground = colors.foreground;
  }
  if (!colors.popoverForeground && colors.foreground) {
    colors.popoverForeground = colors.foreground;
  }
  return colors;
}

export function buildVscodeHostThemeSnapshot(
  kind: HostThemeKind,
): HostThemeSnapshot {
  return {
    kind,
    colors: sampleVscodeThemeColors(),
  };
}
