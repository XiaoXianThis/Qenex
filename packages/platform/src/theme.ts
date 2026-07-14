import type { HostThemeKind } from "./host.ts";

/** 映射到 CSS `color-scheme` / Shiki light-dark */
export function colorSchemeFromHostThemeKind(
  kind: HostThemeKind,
): "light" | "dark" {
  return kind === "dark" || kind === "highContrast" ? "dark" : "light";
}
