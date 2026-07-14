import { describe, expect, test } from "bun:test";
import { parseThemeCss } from "./css-theme.ts";
import {
  colorSchemeFromHostThemeKind,
  expandHostThemeColors,
  mapHostThemeToCss,
  mergeHostThemeColors,
} from "./host-theme.ts";
import { STYLE_THEME_PRESETS } from "./presets.ts";

describe("colorSchemeFromHostThemeKind", () => {
  test("maps light / highContrastLight to light", () => {
    expect(colorSchemeFromHostThemeKind("light")).toBe("light");
    expect(colorSchemeFromHostThemeKind("highContrastLight")).toBe("light");
  });

  test("maps dark / highContrast to dark", () => {
    expect(colorSchemeFromHostThemeKind("dark")).toBe("dark");
    expect(colorSchemeFromHostThemeKind("highContrast")).toBe("dark");
  });
});

describe("expandHostThemeColors", () => {
  test("fills derived fields from core colors", () => {
    const expanded = expandHostThemeColors({
      background: "#111",
      foreground: "#eee",
      muted: "#222",
      border: "#333",
      primary: "#0a84ff",
    });
    expect(expanded.card).toBe("#111");
    expect(expanded.cardForeground).toBe("#eee");
    expect(expanded.popover).toBe("#111");
    expect(expanded.accent).toBe("#222");
    expect(expanded.input).toBe("#333");
    expect(expanded.primaryForeground).toBe("#eee");
  });
});

describe("mapHostThemeToCss", () => {
  test("overrides surface colors and keeps preset radii", () => {
    const css = mapHostThemeToCss({
      kind: "dark",
      colors: {
        background: "#1e1e1e",
        foreground: "#cccccc",
        muted: "#252526",
        mutedForeground: "#9d9d9d",
        border: "#3c3c3c",
        card: "#2d2d2d",
        primary: "#0e639c",
        primaryForeground: "#ffffff",
        accent: "#094771",
        accentForeground: "#ffffff",
        destructive: "#f48771",
      },
    });
    const vars = parseThemeCss(css);
    expect(vars["--background"]).toBe("#1e1e1e");
    expect(vars["--foreground"]).toBe("#cccccc");
    expect(vars["--primary"]).toBe("#0e639c");
    expect(vars["--accent"]).toBe("#094771");
    expect(vars["--destructive"]).toBe("#f48771");
    expect(vars["--radius"]).toBe(
      parseThemeCss(STYLE_THEME_PRESETS.dark.css)["--radius"],
    );
  });

  test("light kind uses light preset radii", () => {
    const theme = mergeHostThemeColors("light", {
      background: "#f3f3f3",
      foreground: "#1e1e1e",
    });
    expect(theme.radii.base).toBe(STYLE_THEME_PRESETS.light.theme.radii.base);
    expect(theme.colors.background).toBe("#f3f3f3");
  });
});
