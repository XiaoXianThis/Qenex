"use client";

import {
  ALLOWED_STYLE_VARS,
  DEFAULT_STYLE_CSS,
  selectActiveCustomCss,
  selectActiveThemeCss,
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

/**
 * 整段 CSS 注入（后写覆盖先写）：
 * 1) 默认层
 * 2) 主题 CSS（随主题切换）
 * 3) 用户自定义 CSS（不随主题切换，优先级最高）
 */
export const ThemeStyleInjector: FC = () => {
  const themeCss = useStyleStore(selectActiveThemeCss);
  const customCss = useStyleStore(selectActiveCustomCss);

  useLayoutEffect(() => {
    clearLegacyStyleArtifacts();
    ensureStyleElement(DEFAULTS_STYLE_ID).textContent = DEFAULT_STYLE_CSS;
    ensureStyleElement(THEME_STYLE_ID).textContent = themeCss;
    ensureStyleElement(CUSTOM_STYLE_ID).textContent = customCss;
  }, [themeCss, customCss]);

  return null;
};
