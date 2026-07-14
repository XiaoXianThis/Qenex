import { describe, expect, test } from "bun:test";
import { createDefaultStyleState } from "./defaults.ts";
import { migratePersistedStyle } from "../store/style-store.ts";

describe("style persist schema v4", () => {
  test("default state is v4 with preset source", () => {
    const state = createDefaultStyleState();
    expect(state.schemaVersion).toBe(4);
    expect(state.themeSource).toBe("preset");
    expect(typeof state.themeCss).toBe("string");
    expect(typeof state.customCss).toBe("string");
  });

  test("migrates v3 to v4 preset", () => {
    const migrated = migratePersistedStyle({
      schemaVersion: 3,
      themeCss: ":root { --background: #fff; }",
      customCss: "/* x */",
    });
    expect(migrated).toEqual({
      schemaVersion: 4,
      themeSource: "preset",
      themeCss: ":root { --background: #fff; }",
      customCss: "/* x */",
    });
  });

  test("keeps followHost on v4", () => {
    const migrated = migratePersistedStyle({
      schemaVersion: 4,
      themeSource: "followHost",
      themeCss: ":root { --background: #111; }",
      customCss: "",
    });
    expect(migrated.themeSource).toBe("followHost");
  });
});
