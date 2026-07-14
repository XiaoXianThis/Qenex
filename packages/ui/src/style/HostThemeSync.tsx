"use client";

import {
  selectThemeSource,
  styleActions,
  useHost,
  useStyleStore,
} from "@qenex/core";
import { useEffect, type FC } from "react";

/**
 * 在 themeSource === "followHost" 时订阅宿主主题，并写入 style store。
 * Web / Desktop 无 getHostTheme 时为 no-op。
 */
export const HostThemeSync: FC = () => {
  const host = useHost();
  const themeSource = useStyleStore(selectThemeSource);

  useEffect(() => {
    if (themeSource !== "followHost") return;
    if (!host.getHostTheme && !host.onHostThemeChange) return;

    let cancelled = false;

    void host.getHostTheme?.().then((snapshot) => {
      if (cancelled || !snapshot) return;
      styleActions.applyHostTheme(snapshot);
    });

    const unsubscribe = host.onHostThemeChange?.((snapshot) => {
      styleActions.applyHostTheme(snapshot);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [host, themeSource]);

  return null;
};
