import { describe, expect, test } from "bun:test";
import {
  displayOptionsForModel,
  hasCachedModelConfigRow,
  hasModelConfigOptions,
  modelIdsNeedingConfigPrefetch,
  planNewSessionBootstrapActions,
  planPreferredThoughtFastActions,
  preferredCatalogId,
  shouldApplyPreferredSessionConfig,
  shouldSkipModelConfigFetch,
  splitThinkingToggleFromCachedOptions,
  triggerOptionsForModel,
  type SessionOption,
} from "./session-config.ts";

const modes: SessionOption[] = [
  { id: "build", name: "Build" },
  { id: "plan", name: "Plan" },
];
const models: SessionOption[] = [
  { id: "m1", name: "Model 1" },
  { id: "m2", name: "Model 2" },
];
const thought: SessionOption[] = [
  { id: "low", name: "Low" },
  { id: "high", name: "High" },
];

describe("hasModelConfigOptions", () => {
  test("empty thought and fast is not a cache hit", () => {
    expect(
      hasModelConfigOptions({ thoughtLevels: [], fastOptions: [] }),
    ).toBe(false);
  });

  test("thought, fast, context, or thinking counts as options", () => {
    expect(
      hasModelConfigOptions({
        thoughtLevels: [{ id: "low", name: "Low" }],
        fastOptions: [],
      }),
    ).toBe(true);
    expect(
      hasModelConfigOptions({
        thoughtLevels: [],
        fastOptions: [{ id: "true", name: "Fast" }],
      }),
    ).toBe(true);
    expect(
      hasModelConfigOptions({
        thoughtLevels: [],
        fastOptions: [],
        contextOptions: [{ id: "272k", name: "272k" }],
      }),
    ).toBe(true);
    expect(
      hasModelConfigOptions({
        thoughtLevels: [],
        fastOptions: [],
        thinkingOptions: [{ id: "on", name: "On" }],
      }),
    ).toBe(true);
  });
});

describe("splitThinkingToggleFromCachedOptions", () => {
  test("splits none out of effort into a thinking toggle", () => {
    const split = splitThinkingToggleFromCachedOptions({
      thoughtLevels: [
        { id: "none", name: "None" },
        { id: "low", name: "Low" },
        { id: "medium", name: "Medium" },
        { id: "high", name: "High" },
        { id: "extra-high", name: "Extra High" },
      ],
      thinkingOptions: [],
      currentThoughtLevelId: "medium",
    });
    expect(split.thoughtLevels.map((item) => item.id)).toEqual([
      "low",
      "medium",
      "high",
      "extra-high",
    ]);
    expect(split.thinkingOptions.map((item) => item.id)).toEqual(["none", "medium"]);
    expect(split.currentThoughtLevelId).toBe("medium");
    expect(split.currentThinkingId).toBe("medium");
  });

  test("does not invent a toggle when effort has no off value", () => {
    const split = splitThinkingToggleFromCachedOptions({
      thoughtLevels: [
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
      ],
      thinkingOptions: [],
    });
    expect(split.thinkingOptions).toEqual([]);
    expect(split.thoughtLevels.map((item) => item.id)).toEqual(["low", "high"]);
  });
});

describe("new session preferred bootstrap", () => {
  test("applies preferred model and mode on a new session", () => {
    expect(shouldApplyPreferredSessionConfig(true)).toBe(true);
    expect(
      planNewSessionBootstrapActions({
        isNewSession: true,
        currentModeId: "build",
        currentModelId: "m1",
        modes,
        models,
        preferredMode: "plan",
        preferredModel: "m2",
      }),
    ).toEqual({ setMode: "plan", setModel: "m2" });
  });

  test("does not overwrite resume / sessions with history", () => {
    expect(shouldApplyPreferredSessionConfig(false)).toBe(false);
    expect(
      planNewSessionBootstrapActions({
        isNewSession: false,
        currentModeId: "build",
        currentModelId: "m1",
        modes,
        models,
        preferredMode: "plan",
        preferredModel: "m2",
      }),
    ).toEqual({ setMode: null, setModel: null });
  });

  test("skips when preferred already matches current (idempotent)", () => {
    expect(
      planNewSessionBootstrapActions({
        isNewSession: true,
        currentModeId: "plan",
        currentModelId: "m2",
        modes,
        models,
        preferredMode: "plan",
        preferredModel: "m2",
      }),
    ).toEqual({ setMode: null, setModel: null });
  });

  test("skips preferred ids missing from the catalog", () => {
    expect(preferredCatalogId("missing", "m1", models)).toBeNull();
    expect(
      planNewSessionBootstrapActions({
        isNewSession: true,
        currentModeId: "build",
        currentModelId: "m1",
        modes,
        models,
        preferredMode: "yolo",
        preferredModel: "nope",
      }),
    ).toEqual({ setMode: null, setModel: null });
  });

  test("new session applies that model's preferred thought", () => {
    expect(
      planPreferredThoughtFastActions({
        applyPreferred: true,
        thoughtLevels: thought,
        fastOptions: [],
        thoughtLevelConfigId: "effort",
        fastConfigId: null,
        currentThoughtLevelId: "low",
        currentFastId: null,
        preferredThought: "high",
        preferredFast: null,
      }),
    ).toEqual({
      setThought: { configId: "effort", value: "high" },
      setFast: null,
    });
  });

  test("resume does not apply preferred thought", () => {
    expect(
      planPreferredThoughtFastActions({
        applyPreferred: false,
        thoughtLevels: thought,
        fastOptions: [],
        thoughtLevelConfigId: "effort",
        fastConfigId: null,
        currentThoughtLevelId: "low",
        currentFastId: null,
        preferredThought: "high",
        preferredFast: null,
      }),
    ).toEqual({ setThought: null, setFast: null });
  });
});

describe("model picker visible prefetch", () => {
  test("opens list: missing cache is fetched, cached rows are skipped", () => {
    expect(
      modelIdsNeedingConfigPrefetch({
        visibleModelIds: ["m1", "m2", "m3"],
        thoughtLevelsByModel: { m1: thought },
        fastOptionsByModel: { m1: [] },
      }),
    ).toEqual(["m2", "m3"]);
  });

  test("empty cached array is a known miss and is not prefetched", () => {
    expect(hasCachedModelConfigRow("m2", [{ m2: [] }, {}])).toBe(true);
    expect(
      modelIdsNeedingConfigPrefetch({
        visibleModelIds: ["m1", "m2"],
        thoughtLevelsByModel: { m2: [] },
        fastOptionsByModel: {},
      }),
    ).toEqual(["m1"]);
  });
});

describe("display / trigger thought fallback", () => {
  test("cached row wins over live, including empty known-none", () => {
    expect(
      displayOptionsForModel({
        modelId: "m2",
        currentModelId: "m1",
        live: thought,
        byModel: { m2: [] },
      }),
    ).toEqual([]);
    expect(
      displayOptionsForModel({
        modelId: "m1",
        currentModelId: "m1",
        live: thought,
        byModel: { m1: [{ id: "max", name: "Max" }] },
      }),
    ).toEqual([{ id: "max", name: "Max" }]);
  });

  test("uncached other models do not inherit live thought", () => {
    expect(
      displayOptionsForModel({
        modelId: "m2",
        currentModelId: "m1",
        live: thought,
        byModel: {},
      }),
    ).toBeNull();
  });

  test("current model can use live options before cache", () => {
    expect(
      displayOptionsForModel({
        modelId: "m1",
        currentModelId: "m1",
        live: thought,
        byModel: {},
      }),
    ).toEqual(thought);
  });

  test("empty live and no cache does not pretend there is thought", () => {
    expect(
      displayOptionsForModel({
        modelId: "m2",
        currentModelId: "m1",
        live: [],
        byModel: {},
      }),
    ).toBeNull();
  });

  test("trigger uses cache when live thought is empty", () => {
    expect(
      triggerOptionsForModel({
        live: [],
        currentModelId: "m1",
        byModel: { m1: thought },
      }),
    ).toEqual(thought);
    expect(
      triggerOptionsForModel({
        live: thought,
        currentModelId: "m1",
        byModel: { m1: [{ id: "stale", name: "Stale" }] },
      }),
    ).toEqual(thought);
  });
});

describe("gear fetch skip heuristic", () => {
  test("does not skip other models just because live thought is filled", () => {
    expect(
      shouldSkipModelConfigFetch({
        modelId: "m2",
        currentModelId: "m1",
        maps: [{}, {}],
        liveHasOptions: true,
      }),
    ).toBe(false);
  });

  test("skips current model when live options already exist", () => {
    expect(
      shouldSkipModelConfigFetch({
        modelId: "m1",
        currentModelId: "m1",
        maps: [{}, {}],
        liveHasOptions: true,
      }),
    ).toBe(true);
  });

  test("skips any model that already has a cache row", () => {
    expect(
      shouldSkipModelConfigFetch({
        modelId: "m2",
        currentModelId: "m1",
        maps: [{ m2: [{ id: "xhigh", name: "Extra high" }] }, {}],
        liveHasOptions: true,
      }),
    ).toBe(true);
  });
});
