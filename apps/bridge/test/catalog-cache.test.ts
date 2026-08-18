import { describe, expect, test } from "bun:test";
import {
  AgentCatalogCache,
  catalogCacheKey,
  restoreProbedModel,
  shouldSelfProbeCurrentModel,
  shouldSkipModelConfigProbe,
} from "../src/session-store.ts";

describe("catalog cache isolation", () => {
  test("key is agentId + cwd without version", () => {
    expect(catalogCacheKey("opencode", "/tmp/app")).toBe("opencode::/tmp/app");
    expect(catalogCacheKey("cursor-agent", "/tmp/app")).toBe(
      "cursor-agent::/tmp/app",
    );
  });

  test("same cwd different agents do not pollute each other", () => {
    const cache = new AgentCatalogCache();
    const cwd = "/tmp/shared";
    cache.remember("opencode", cwd, {
      modes: {
        currentModeId: "build",
        availableModes: [{ id: "build", name: "build" }],
      },
      models: {
        currentModelId: "opencode/big-pickle",
        availableModels: [{ modelId: "opencode/big-pickle", name: "Big Pickle" }],
      },
    });
    cache.remember("cursor-agent", cwd, {
      modes: {
        currentModeId: "agent",
        availableModes: [{ id: "agent", name: "Agent" }],
      },
      models: {
        currentModelId: "gpt-5",
        availableModels: [{ modelId: "gpt-5", name: "GPT-5" }],
      },
    });

    expect(cache.get("opencode", cwd)?.models?.currentModelId).toBe(
      "opencode/big-pickle",
    );
    expect(cache.get("cursor-agent", cwd)?.models?.currentModelId).toBe("gpt-5");
    expect(cache.get("opencode", cwd)?.modes?.availableModes?.map((m) => m.id)).toEqual(
      ["build"],
    );
    expect(
      cache.get("cursor-agent", cwd)?.modes?.availableModes?.map((m) => m.id),
    ).toEqual(["agent"]);
    expect(cache.get("generic-acp", cwd)).toBeUndefined();
  });
});

describe("probe restore", () => {
  test("restores the original model after a probe switch", async () => {
    const calls: string[] = [];
    const outcome = await restoreProbedModel({
      originalModelId: "codex/[default]",
      currentModelId: "codex/[low]",
      restore: async (modelId) => {
        calls.push(modelId);
      },
    });
    expect(outcome).toBe("restored");
    expect(calls).toEqual(["codex/[default]"]);
  });

  test("still attempts restore when the restore RPC fails", async () => {
    let attempted = false;
    const outcome = await restoreProbedModel({
      originalModelId: "codex/[default]",
      currentModelId: "codex/[low]",
      restore: async () => {
        attempted = true;
        throw new Error("set_model_failed");
      },
    });
    expect(attempted).toBe(true);
    expect(outcome).toBe("failed");
  });

  test("skips restore when current model is already the original", async () => {
    let called = false;
    const outcome = await restoreProbedModel({
      originalModelId: "codex/[default]",
      currentModelId: "codex/[default]",
      restore: async () => {
        called = true;
      },
    });
    expect(called).toBe(false);
    expect(outcome).toBe("skipped");
  });
});

describe("shouldSkipModelConfigProbe", () => {
  test("OpenCode-style advertised empty thought still probes other models", () => {
    expect(
      shouldSkipModelConfigProbe({
        configDiscovery: "advertised",
        currentModelId: "opencode/laguna",
        requestedModelId: "openai/gpt-5.6-sol",
        hasCachedSnapshot: false,
        liveHasThoughtOrFast: false,
      }),
    ).toBe(false);
  });

  test("Codex-style session-level thought skips probe without a per-model map", () => {
    expect(
      shouldSkipModelConfigProbe({
        configDiscovery: "advertised",
        currentModelId: "gpt-5.6-sol",
        requestedModelId: "gpt-5.6-terra",
        hasCachedSnapshot: false,
        liveHasThoughtOrFast: true,
        hasPerModelAdvertisedMap: false,
      }),
    ).toBe(true);
  });

  test("per-model advertised map does not copy live thought to other models", () => {
    expect(
      shouldSkipModelConfigProbe({
        configDiscovery: "advertised",
        currentModelId: "gpt-5.6-sol",
        requestedModelId: "gpt-5.6-terra",
        hasCachedSnapshot: false,
        liveHasThoughtOrFast: true,
        hasPerModelAdvertisedMap: true,
        hasAdvertisedModelSnapshot: false,
      }),
    ).toBe(false);
    expect(
      shouldSkipModelConfigProbe({
        configDiscovery: "advertised",
        currentModelId: "gpt-5.6-sol",
        requestedModelId: "gpt-5.6-terra",
        hasCachedSnapshot: false,
        liveHasThoughtOrFast: true,
        hasPerModelAdvertisedMap: true,
        hasAdvertisedModelSnapshot: true,
      }),
    ).toBe(true);
  });

  test("per-model-probe-fallback probes when uncached", () => {
    expect(
      shouldSkipModelConfigProbe({
        configDiscovery: "per-model-probe-fallback",
        currentModelId: "opencode/laguna",
        requestedModelId: "openai/gpt-5.6-sol",
        hasCachedSnapshot: false,
        liveHasThoughtOrFast: false,
      }),
    ).toBe(false);
  });

  test("cached snapshot and current model skip probe", () => {
    expect(
      shouldSkipModelConfigProbe({
        configDiscovery: "per-model-probe-fallback",
        currentModelId: "m1",
        requestedModelId: "m2",
        hasCachedSnapshot: true,
        liveHasThoughtOrFast: false,
      }),
    ).toBe(true);
    expect(
      shouldSkipModelConfigProbe({
        configDiscovery: "per-model-probe-fallback",
        currentModelId: "m1",
        requestedModelId: "m1",
        hasCachedSnapshot: false,
        liveHasThoughtOrFast: false,
      }),
    ).toBe(true);
  });
});

describe("shouldSelfProbeCurrentModel", () => {
  test("per-model-probe-fallback with empty thought probes the current model", () => {
    expect(
      shouldSelfProbeCurrentModel({
        configDiscovery: "per-model-probe-fallback",
        currentModelId: "opencode/laguna",
        liveHasThoughtOrFast: false,
      }),
    ).toBe(true);
  });

  test("advertised with thought does not self-probe", () => {
    expect(
      shouldSelfProbeCurrentModel({
        configDiscovery: "advertised",
        currentModelId: "gpt-5.6-sol",
        liveHasThoughtOrFast: true,
      }),
    ).toBe(false);
  });

  test("advertised empty thought still does not self-probe", () => {
    expect(
      shouldSelfProbeCurrentModel({
        configDiscovery: "advertised",
        currentModelId: "m1",
        liveHasThoughtOrFast: false,
      }),
    ).toBe(false);
  });

  test("skips when thought or fast already live", () => {
    expect(
      shouldSelfProbeCurrentModel({
        configDiscovery: "per-model-probe-fallback",
        currentModelId: "opencode/laguna",
        liveHasThoughtOrFast: true,
      }),
    ).toBe(false);
  });

  test("skips when there is no current model", () => {
    expect(
      shouldSelfProbeCurrentModel({
        configDiscovery: "per-model-probe-fallback",
        currentModelId: null,
        liveHasThoughtOrFast: false,
      }),
    ).toBe(false);
  });
});
