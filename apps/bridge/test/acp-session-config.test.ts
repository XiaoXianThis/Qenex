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

  test("grouped options with a value still flatten nested leaves", () => {
    const flat = flattenAcpSelectOptions([
      {
        value: "structure/openai/gpt-5.6-sol",
        name: "Structure",
        options: [{ value: "openai/gpt-5.6-sol", name: "GPT-5.6-Sol" }],
      },
    ]);
    expect(flat).toEqual([{ id: "openai/gpt-5.6-sol", name: "GPT-5.6-Sol" }]);
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

  test("maps OpenCode effort configOption (category thought_level) to thoughtLevels", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "tokenhub/gpt-5.6-sol",
          options: [
            { value: "opencode/big-pickle", name: "Big Pickle" },
            { value: "tokenhub/gpt-5.6-sol", name: "GPT 5.6 Sol" },
          ],
        },
        {
          id: "effort",
          name: "Effort",
          description: "Available effort levels for this model",
          category: "thought_level",
          type: "select",
          currentValue: "medium",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
            { value: "max", name: "Max" },
          ],
        },
        {
          id: "mode",
          name: "Session Mode",
          category: "mode",
          type: "select",
          currentValue: "build",
          options: [
            { value: "build", name: "build" },
            { value: "plan", name: "plan" },
          ],
        },
      ],
    });
    expect(normalized.thoughtLevels?.configId).toBe("effort");
    expect(normalized.thoughtLevels?.currentId).toBe("medium");
    expect(normalized.thoughtLevels?.available.map((level) => level.id)).toEqual(
      ["low", "medium", "high", "max"],
    );
    expect(normalized.models?.currentModelId).toBe("tokenhub/gpt-5.6-sol");
  });

  test("omits thoughtLevels when OpenCode snapshot has no effort option", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          id: "model",
          category: "model",
          currentValue: "opencode/big-pickle",
          options: [{ value: "opencode/big-pickle", name: "Big Pickle" }],
        },
        {
          id: "mode",
          category: "mode",
          currentValue: "build",
          options: [{ value: "build", name: "build" }],
        },
      ],
    });
    expect(normalized.thoughtLevels).toBeUndefined();
    expect(normalized.fastOptions).toBeUndefined();
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
    expect(dto.nativeResume).toBe(true);
  });

  test("nativeResume is false for cursor-agent", () => {
    const dto = sessionInfoToConfigDto({
      sessionId: "ses_c",
      agent: "cursor-agent",
      cwd: "/tmp",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(dto.nativeResume).toBe(false);
    expect(dto).not.toHaveProperty("configDiscovery");
    expect(dto).not.toHaveProperty("usesPerModelConfigProbe");
    expect(dto).not.toHaveProperty("scope");
  });

  test("nativeResume is false for qoder reconnect-fresh", () => {
    const dto = sessionInfoToConfigDto({
      sessionId: "ses_q",
      agent: "qoder",
      cwd: "/tmp",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(dto.nativeResume).toBe(false);
  });

  test("maps think alias onto thoughtLevels", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          id: "think",
          name: "Think",
          currentValue: "medium",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
          ],
        },
      ],
    });
    expect(normalized.thoughtLevels?.configId).toBe("think");
    expect(normalized.thoughtLevels?.currentId).toBe("medium");
  });

  test("maps ACP v2 configId thought/fast options", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          configId: "reasoning",
          name: "Thinking",
          category: "thought_level",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
        {
          configId: "fast",
          name: "Fast",
          category: "model_config",
          currentValue: false,
          options: [
            { value: "false", name: "Off" },
            { value: "true", name: "On" },
          ],
        },
      ],
    });
    expect(normalized.thoughtLevels?.configId).toBe("reasoning");
    expect(normalized.thoughtLevels?.currentId).toBe("high");
    expect(normalized.fastOptions?.configId).toBe("fast");
    expect(normalized.fastOptions?.currentId).toBe("false");
  });

  test("keeps thinking toggle, intensity, and context as separate axes", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          id: "thinking",
          name: "Thinking",
          category: "thinking",
          currentValue: "on",
          options: [
            { value: "off", name: "Off" },
            { value: "on", name: "On" },
          ],
        },
        {
          id: "effort",
          name: "Effort",
          category: "thought_level",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
            { value: "xhigh", name: "Extra high" },
          ],
        },
        {
          id: "context_window",
          name: "Context",
          currentValue: "272k",
          options: [
            { value: "200k", name: "200k" },
            { value: "272k", name: "272k" },
          ],
        },
        {
          id: "fast",
          name: "Fast",
          currentValue: "false",
          options: [
            { value: "false", name: "Off" },
            { value: "true", name: "On" },
          ],
        },
      ],
    });
    expect(normalized.thinkingOptions?.configId).toBe("thinking");
    expect(normalized.thinkingOptions?.available.map((t) => t.id)).toEqual([
      "off",
      "on",
    ]);
    expect(normalized.thoughtLevels?.configId).toBe("effort");
    expect(normalized.thoughtLevels?.available.map((t) => t.id)).toEqual([
      "low",
      "high",
      "xhigh",
    ]);
    expect(normalized.contextOptions?.configId).toBe("context_window");
    expect(normalized.fastOptions?.configId).toBe("fast");
  });

  test("splits none out of effort into a thinking toggle", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          id: "reasoning",
          currentValue: "none",
          options: [
            { value: "none", name: "None" },
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
            { value: "extra-high", name: "Extra High" },
          ],
        },
      ],
    });
    expect(normalized.thinkingOptions?.configId).toBe("reasoning");
    expect(normalized.thinkingOptions?.currentId).toBe("none");
    expect(normalized.thinkingOptions?.available.map((t) => t.id)).toEqual([
      "none",
      "low",
    ]);
    expect(normalized.thoughtLevels?.available.map((t) => t.id)).toEqual([
      "low",
      "medium",
      "high",
      "extra-high",
    ]);
  });

  test("maps camelCase contextLength and thinkingEnabled", () => {
    const normalized = normalizeAcpSessionConfig({
      configOptions: [
        {
          id: "thinkingEnabled",
          currentValue: "true",
          options: [
            { value: "false", name: "Off" },
            { value: "true", name: "On" },
          ],
        },
        {
          id: "reasoningEffort",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
        {
          id: "contextLength",
          currentValue: "272k",
          options: [
            { value: "200k", name: "200k" },
            { value: "272k", name: "272k" },
          ],
        },
        {
          id: "fastMode",
          currentValue: "false",
          options: [
            { value: "false", name: "Off" },
            { value: "true", name: "On" },
          ],
        },
      ],
    });
    expect(normalized.thinkingOptions?.configId).toBe("thinkingEnabled");
    expect(normalized.thoughtLevels?.configId).toBe("reasoningEffort");
    expect(normalized.contextOptions?.configId).toBe("contextLength");
    expect(normalized.fastOptions?.configId).toBe("fastMode");
  });
});
