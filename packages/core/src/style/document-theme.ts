import type { HostThemeKind } from "@qenex/platform";
import { parseThemeCss } from "./css-theme.ts";
import { DEFAULT_STYLE_CSS, DEFAULT_STYLE_VARS } from "./defaults.ts";
import { colorSchemeFromHostThemeKind } from "./host-theme.ts";
import { STYLE_THEME_PRESETS } from "./presets.ts";
import { ALLOWED_STYLE_VARS, type ThemeSource } from "./types.ts";

const DEFAULTS_STYLE_ID = "agent-center-style-defaults";
const THEME_STYLE_ID = "agent-center-style-theme";
const CUSTOM_STYLE_ID = "agent-center-style-custom";
const CANVAS_STYLE_ID = "agent-center-style-canvas";

/** 首屏脚本读取：避免 JS hydrate 前 html/body 仍是默认亮色 */
export const BOOT_THEME_STORAGE_KEY = "qenex:boot-theme";

const CANVAS_CSS = `html, body, #root {
  background-color: var(--background);
  color: var(--foreground);
}`;

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

function resolveColorScheme(
  themeSource: ThemeSource,
  themeCss: string,
  hostThemeKind: HostThemeKind | null,
): "light" | "dark" {
  if (themeSource === "followHost" && hostThemeKind) {
    return colorSchemeFromHostThemeKind(hostThemeKind);
  }
  if (themeSource === "followSystem") {
    if (themeCss.trim() === STYLE_THEME_PRESETS.dark.css.trim()) {
      return "dark";
    }
    if (themeCss.trim() === STYLE_THEME_PRESETS.light.css.trim()) {
      return "light";
    }
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      try {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      } catch {
        return "light";
      }
    }
    return "light";
  }
  if (themeCss.trim() === STYLE_THEME_PRESETS.dark.css.trim()) {
    return "dark";
  }
  if (themeCss.trim() === STYLE_THEME_PRESETS.light.css.trim()) {
    return "light";
  }
  // 自定义 CSS：用背景相对亮度粗判
  const bg =
    parseThemeCss(themeCss)["--background"] ?? DEFAULT_STYLE_VARS["--background"];
  return isLikelyDarkColor(bg) ? "dark" : "light";
}

function isLikelyDarkColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("oklch(")) {
    const match = v.match(/oklch\(\s*([\d.]+)/);
    if (match?.[1]) {
      const L = Number(match[1]);
      return Number.isFinite(L) && L < 0.5;
    }
  }
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex.slice(0, 6);
    if (full.length === 6) {
      const r = Number.parseInt(full.slice(0, 2), 16);
      const g = Number.parseInt(full.slice(2, 4), 16);
      const b = Number.parseInt(full.slice(4, 6), 16);
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        // relative luminance (sRGB approx)
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return lum < 0.45;
      }
    }
  }
  return false;
}

/** 同步 color-scheme，并挂上 `.dark` 供 Tailwind `dark:` 变体跟随应用主题 */
function syncColorScheme(scheme: "light" | "dark") {
  const root = document.documentElement;
  root.style.colorScheme = scheme;
  root.dataset.colorScheme = scheme;
  root.classList.toggle("dark", scheme === "dark");
}

/**
 * 直接给 html/body 上色（覆盖宿主页内联 transparent 等），
 * 并写入 boot 缓存供下次 HTML 解析时立刻使用。
 */
function syncDocumentCanvas(
  themeCss: string,
  colorScheme: "light" | "dark",
) {
  const vars = parseThemeCss(themeCss);
  const background =
    vars["--background"] ?? DEFAULT_STYLE_VARS["--background"];
  const foreground =
    vars["--foreground"] ?? DEFAULT_STYLE_VARS["--foreground"];

  const root = document.documentElement;
  root.style.backgroundColor = background;
  root.style.color = foreground;

  const body = document.body;
  if (body) {
    body.style.backgroundColor = background;
    body.style.color = foreground;
  }

  ensureStyleElement(CANVAS_STYLE_ID).textContent = CANVAS_CSS;

  try {
    localStorage.setItem(
      BOOT_THEME_STORAGE_KEY,
      JSON.stringify({ background, foreground, colorScheme }),
    );
  } catch {
    // private mode / 无 localStorage 的宿主
  }
}

export type DocumentThemeStyles = {
  themeCss: string;
  customCss: string;
  themeSource: ThemeSource;
  hostThemeKind: HostThemeKind | null;
};

/**
 * 将主题 CSS 写入 document（可在 React 挂载 / hydrate 完成前调用，
 * 并同步 html/body 画布色，避免 Loading / 过滚动露底仍是默认亮色）。
 */
export function applyDocumentThemeStyles(styles: DocumentThemeStyles): void {
  if (typeof document === "undefined") return;

  clearLegacyStyleArtifacts();
  ensureStyleElement(DEFAULTS_STYLE_ID).textContent = DEFAULT_STYLE_CSS;
  ensureStyleElement(THEME_STYLE_ID).textContent = styles.themeCss;
  ensureStyleElement(CUSTOM_STYLE_ID).textContent = styles.customCss;

  const colorScheme = resolveColorScheme(
    styles.themeSource,
    styles.themeCss,
    styles.hostThemeKind,
  );
  syncColorScheme(colorScheme);
  syncDocumentCanvas(styles.themeCss, colorScheme);
}
