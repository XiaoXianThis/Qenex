"use client";

import {
  ALLOWED_STYLE_VARS,
  DEFAULT_STYLE_CSS,
  STYLE_THEME_PRESETS,
  colorSchemeFromHostThemeKind,
  selectActiveCustomCss,
  selectActiveThemeCss,
  selectHostThemeKind,
  selectThemeSource,
  useStyleStore,
} from "@qenex/core";
import { useLayoutEffect, type FC } from "react";

const DEFAULTS_STYLE_ID = "agent-center-style-defaults";
const THEME_STYLE_ID = "agent-center-style-theme";
const CUSTOM_STYLE_ID = "agent-center-style-custom";

function ensureStyleElement(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  return el;
}

/** 清除旧版 setProperty / 单层 user style 残留 */
function clearLegacyStyleArtifacts() {
  const root = document.documentElement;
  for (const name of ALLOWED_STYLE_VARS) {
    root.style.removeProperty(name);
  }
  document.getElementById("agent-center-style-user")?.remove();
}

/** 同步 color-scheme，供 Shiki `light-dark()` 双主题与系统控件跟随 */
function syncColorScheme(
  themeSource: "preset" | "followHost",
  themeCss: string,
  hostThemeKind: ReturnType<typeof selectHostThemeKind>,
) {
  if (themeSource === "followHost" && hostThemeKind) {
    document.documentElement.style.colorScheme =
      colorSchemeFromHostThemeKind(hostThemeKind);
    return;
  }
  const isDark = themeCss.trim() === STYLE_THEME_PRESETS.dark.css.trim();
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

/**
 * 整段 CSS 注入（后写覆盖先写）：
 * 1) 默认层
 * 2) 主题 CSS（随主题切换）
 * 3) 用户自定义 CSS（不随主题切换，优先级最高）
 */
export const ThemeStyleInjector: FC = () => {
  const themeCss = useStyleStore(selectActiveThemeCss);
  const customCss = useStyleStore(selectActiveCustomCss);
  const themeSource = useStyleStore(selectThemeSource);
  const hostThemeKind = useStyleStore(selectHostThemeKind);

  useLayoutEffect(() => {
    clearLegacyStyleArtifacts();
    ensureStyleElement(DEFAULTS_STYLE_ID).textContent = DEFAULT_STYLE_CSS;
    ensureStyleElement(THEME_STYLE_ID).textContent = themeCss;
    ensureStyleElement(CUSTOM_STYLE_ID).textContent = customCss;
    syncColorScheme(themeSource, themeCss, hostThemeKind);
  }, [themeCss, customCss, themeSource, hostThemeKind]);

  return null;
};
