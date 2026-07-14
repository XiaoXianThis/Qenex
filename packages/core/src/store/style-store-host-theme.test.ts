import { describe, expect, test, beforeEach } from "bun:test";
import {
  resetStyleStoreForTests,
  styleActions,
  styleStore,
} from "./style-store.ts";
import { STYLE_THEME_PRESETS } from "../style/presets.ts";
import { parseThemeCss } from "../style/css-theme.ts";

describe("styleStore followHost", () => {
  beforeEach(() => {
    resetStyleStoreForTests();
  });

  test("enableFollowHost + applyHostTheme writes mapped css", () => {
    styleActions.enableFollowHost();
    expect(styleStore.themeSource).toBe("followHost");

    styleActions.applyHostTheme({
      kind: "dark",
      colors: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        primary: "#007acc",
        primaryForeground: "#ffffff",
        border: "#474747",
        muted: "#2a2a2a",
        mutedForeground: "#9d9d9d",
        card: "#252526",
      },
    });

    expect(styleStore.hostThemeKind).toBe("dark");
    const vars = parseThemeCss(styleStore.themeCss);
    expect(vars["--background"]).toBe("#1e1e1e");
    expect(vars["--primary"]).toBe("#007acc");
  });

  test("applyHostTheme is ignored when not followHost", () => {
    const before = styleStore.themeCss;
    styleActions.applyHostTheme({
      kind: "dark",
      colors: { background: "#000000" },
    });
    expect(styleStore.themeCss).toBe(before);
  });

  test("applyThemePreset exits followHost", () => {
    styleActions.enableFollowHost();
    styleActions.applyThemePreset("light");
    expect(styleStore.themeSource).toBe("preset");
    expect(styleStore.hostThemeKind).toBeNull();
    expect(styleStore.themeCss.trim()).toBe(
      STYLE_THEME_PRESETS.light.css.trim(),
    );
  });

  test("committing theme css edit exits followHost", () => {
    styleActions.enableFollowHost();
    styleActions.applyHostTheme({
      kind: "light",
      colors: { background: "#fff", foreground: "#000" },
    });
    styleActions.setEditMode(true);
    styleActions.updateDraftThemeCss(":root { --background: #abc; }");
    styleActions.setEditMode(false);
    expect(styleStore.themeSource).toBe("preset");
    expect(styleStore.themeCss).toContain("#abc");
  });

  test("committing only customCss keeps followHost", () => {
    styleActions.enableFollowHost();
    styleActions.applyHostTheme({
      kind: "dark",
      colors: { background: "#111", foreground: "#eee" },
    });
    styleActions.setEditMode(true);
    styleActions.updateDraftCustomCss("body { opacity: 1; }");
    styleActions.setEditMode(false);
    expect(styleStore.themeSource).toBe("followHost");
    expect(styleStore.customCss).toContain("opacity");
  });
});
