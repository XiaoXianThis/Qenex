import { describe, expect, test } from "bun:test";
import {
  hostThemeKindOnly,
  mapVscodeColorThemeKind,
} from "../src/messages.ts";

describe("mapVscodeColorThemeKind", () => {
  const ColorThemeKind = {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  };

  test("maps vscode kinds", () => {
    expect(mapVscodeColorThemeKind(1, ColorThemeKind)).toBe("light");
    expect(mapVscodeColorThemeKind(2, ColorThemeKind)).toBe("dark");
    expect(mapVscodeColorThemeKind(3, ColorThemeKind)).toBe("highContrast");
    expect(mapVscodeColorThemeKind(4, ColorThemeKind)).toBe(
      "highContrastLight",
    );
  });
});

describe("hostThemeKindOnly", () => {
  test("returns empty colors for webview sampling", () => {
    expect(hostThemeKindOnly("dark")).toEqual({ kind: "dark", colors: {} });
  });
});
