import { describe, expect, test } from "bun:test";
import {
  toolProgressActions,
  toolProgressStore,
} from "../store/tool-progress-store.ts";

describe("toolProgressStore", () => {
  test("setProgress replaces cumulative snapshots", () => {
    toolProgressActions.clearAll();
    toolProgressActions.setProgress("c1", "a");
    toolProgressActions.setProgress("c1", "ab");
    expect(toolProgressStore.byId.c1).toBe("ab");
    toolProgressActions.clear("c1");
    expect(toolProgressStore.byId.c1).toBeUndefined();
  });
});
