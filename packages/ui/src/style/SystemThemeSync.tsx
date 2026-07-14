"use client";

import {
  selectThemeSource,
  styleActions,
  useStyleStore,
} from "@qenex/core";
import { useEffect, type FC } from "react";

/**
 * 在 themeSource === "followSystem" 时订阅 prefers-color-scheme，并写入亮/暗预设。
 */
export const SystemThemeSync: FC = () => {
  const themeSource = useStyleStore(selectThemeSource);

  useEffect(() => {
    if (themeSource !== "followSystem") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      styleActions.applySystemColorScheme("light");
      return;
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      styleActions.applySystemColorScheme(mq.matches ? "dark" : "light");
    };
    apply();

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }

    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, [themeSource]);

  return null;
};
