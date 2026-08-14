import { describe, expect, test } from "bun:test";
import {
  flattenAcpSelectOptions,
  normalizeAcpSessionConfig,
} from "../src/acp-session-config.ts";
import { sessionInfoToConfigDto } from "../src/session-config-dto.ts";

describe("acp-session-config", () => {
  test("flattens grouped select options", () => {
    const flat = flattenAcpSelectOptions([
      {
        group: "g1",
        name: "Group",
        options: [
          { value: "a", name: "A" },
          { value: "b", name: "B", description: "bee" },
        ],
      },
    ]);
    expect(flat).toEqual([
      { id: "a", name: "A" },
      { id: "b", name: "B", description: "bee" },
    ]);
  });

  test("maps OpenCode-style configOptions to modes/models", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "opencode/big-pickle",
          options: [
            { value: "opencode/big-pickle", name: "Big Pickle" },
            { value: "opencode/other", name: "Other" },
          ],
        },
        {
          id: "mode",
          name: "Session Mode",
          category: "mode",
          type: "select",
          currentValue: "build",
          options: [
            { value: "build", name: "build", description: "default" },
            { value: "plan", name: "plan" },
          ],
        },
      ],
    });

    expect(normalized.modes?.currentModeId).toBe("build");
    expect(normalized.modes?.availableModes?.map((m) => m.id)).toEqual([
      "build",
      "plan",
    ]);
    expect(normalized.models?.currentModelId).toBe("opencode/big-pickle");
    expect(normalized.models?.availableModels?.map((m) => m.modelId)).toEqual([
      "opencode/big-pickle",
      "opencode/other",
    ]);
  });

  test("prefers legacy modes/models over configOptions", () => {
    const normalized = normalizeAcpSessionConfig({
      modes: {
        currentModeId: "legacy-mode",
        availableModes: [{ id: "legacy-mode", name: "Legacy" }],
      },
      models: {
        currentModelId: "legacy-model",
        availableModels: [{ modelId: "legacy-model", name: "Legacy Model" }],
      },
      configOptions: [
        {
          id: "mode",
          category: "mode",
          currentValue: "build",
          options: [{ value: "build", name: "build" }],
        },
      ],
    });
    expect(normalized.modes?.currentModeId).toBe("legacy-mode");
    expect(normalized.models?.currentModelId).toBe("legacy-model");
  });

  test("normalizes thought and fast aliases across agents", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          id: "reasoning-effort",
          name: "Reasoning Effort",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
        {
          id: "fast_mode",
          name: "Fast Mode",
          currentValue: "false",
          options: [
            { value: "false", name: "Off" },
            { value: "true", name: "On" },
          ],
        },
      ],
    });
    expect(normalized.thoughtLevels?.configId).toBe("reasoning-effort");
    expect(normalized.thoughtLevels?.currentId).toBe("high");
    expect(normalized.fastOptions?.configId).toBe("fast_mode");
    expect(normalized.fastOptions?.currentId).toBe("false");
  });

  test("sessionInfoToConfigDto surfaces descriptions", () => {
    const dto = sessionInfoToConfigDto({
      sessionId: "ses_x",
      agent: "opencode",
      cwd: "/tmp",
      createdAt: "2026-01-01T00:00:00.000Z",
      modes: {
        currentModeId: "plan",
        availableModes: [
          { id: "build", name: "build" },
          { id: "plan", name: "plan", description: "no edits" },
        ],
      },
      models: {
        currentModelId: "m1",
        availableModels: [{ modelId: "m1", name: "M1" }],
      },
      thoughtLevels: {
        configId: "reasoning_effort",
        currentId: "high",
        available: [
          { id: "low", name: "Low" },
          { id: "high", name: "High" },
        ],
      },
      fastOptions: {
        configId: "fast",
        currentId: "true",
        available: [
          { id: "false", name: "Off" },
          { id: "true", name: "On" },
        ],
      },
    });
    expect(dto.currentModeId).toBe("plan");
    expect(dto.modes.find((m) => m.id === "plan")?.description).toBe("no edits");
    expect(dto.models).toEqual([{ id: "m1", name: "M1" }]);
    expect(dto.currentThoughtLevelId).toBe("high");
    expect(dto.thoughtLevelConfigId).toBe("reasoning_effort");
    expect(dto.currentFastId).toBe("true");
    expect(dto.fastConfigId).toBe("fast");
  });
});
