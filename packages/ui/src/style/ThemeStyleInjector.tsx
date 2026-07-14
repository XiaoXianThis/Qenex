"use client";

import {
  applyDocumentThemeStyles,
  selectActiveCustomCss,
  selectActiveThemeCss,
  selectHostThemeKind,
  selectThemeSource,
  useStyleStore,
} from "@qenex/core";
import { useLayoutEffect, type FC } from "react";

/**
 * 整段 CSS 注入（后写覆盖先写）：
 * 1) 默认层
 * 2) 主题 CSS（随主题切换）
 * 3) 用户自定义 CSS（不随主题切换，优先级最高）
 *
 * Host hydrate 阶段也会提前调用 applyDocumentThemeStyles，避免 Loading 闪亮色。
 */
export const ThemeStyleInjector: FC = () => {
  const themeCss = useStyleStore(selectActiveThemeCss);
  const customCss = useStyleStore(selectActiveCustomCss);
  const themeSource = useStyleStore(selectThemeSource);
  const hostThemeKind = useStyleStore(selectHostThemeKind);

  useLayoutEffect(() => {
    applyDocumentThemeStyles({
      themeCss,
      customCss,
      themeSource,
      hostThemeKind,
    });
  }, [themeCss, customCss, themeSource, hostThemeKind]);

  return null;
};
