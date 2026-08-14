import { describe, expect, test } from "bun:test";
import {
  applyCompatCatalog,
  resolveAgentCompat,
} from "../src/agent/compat/registry.ts";
import { genericAcpCompat } from "../src/agent/compat/generic-acp.ts";
import {
  normalizeOpenCodeCatalog,
  opencodeCompat,
} from "../src/agent/compat/opencode.ts";
import { cursorCompat } from "../src/agent/compat/cursor.ts";
import { normalizeCodexCatalog } from "../src/agent/compat/codex.ts";
import { normalizePiCatalog } from "../src/agent/compat/pi.ts";
import { normalizeClaudeCatalog } from "../src/agent/compat/claude.ts";
import { buildOpenCodeConfigContent } from "../src/opencode-config.ts";
import {
  MODE_THOUGHT_CONFIG_ID,
  normalizeAcpSessionConfig,
} from "../src/acp-session-config.ts";
import { errorText, inspectAgentError } from "../src/agent/compat/types.ts";

describe("errorText / inspectAgentError", () => {
  test("extracts JSON-RPC message instead of [object Object]", () => {
    const text = errorText({
      code: -32602,
      message: "Invalid params: model not found: x",
    });
    expect(text).toContain("model not found");
    expect(text).not.toContain("[object Object]");
  });

  test("extracts nested data.details", () => {
    const text = errorText({
      message: "Internal error",
      data: { details: "No previous sessions found" },
    });
    expect(text).toContain("previous sessions");
  });

  test("treats Internal error plus auth details as auth", () => {
    expect(
      inspectAgentError({
        message: "Internal error",
        data: { details: "Unauthorized: please login" },
      }),
    ).toBe("auth");
  });

  test("treats token expired as auth", () => {
    expect(inspectAgentError(new Error("Authentication token expired"))).toBe(
      "auth",
    );
  });

  test("treats ACP auth-required code as auth even with Internal error", () => {
    expect(
      inspectAgentError({ code: -32000, message: "Internal error" }),
    ).toBe("auth");
  });
});

describe("AgentCompat registry", () => {
  test("unknown agent falls back to generic-acp", () => {
    const compat = resolveAgentCompat("some-new-agent");
    expect(compat.id).toBe("generic-acp");
    expect(compat.configDiscovery).toBe("advertised");
    expect(compat.resume).toBe("native-load");
    expect(compat).toMatchObject({
      configDiscovery: genericAcpCompat.configDiscovery,
      resume: genericAcpCompat.resume,
    });
  });

  test("opencode injects OPENCODE_CONFIG_CONTENT via augmentLaunch", () => {
    expect(opencodeCompat.configDiscovery).toBe("per-model-probe-fallback");
    expect(opencodeCompat.resume).toBe("native-load");
    const patch = opencodeCompat.augmentLaunch?.({
      cwd: "/tmp",
      agentId: "opencode",
      command: ["opencode", "acp"],
    });
    expect(patch?.env?.OPENCODE_CONFIG_CONTENT).toBe(
      buildOpenCodeConfigContent(process.env.OPENCODE_CONFIG_CONTENT),
    );
    expect(JSON.parse(patch!.env!.OPENCODE_CONFIG_CONTENT as string).permission).toBeTruthy();
  });

  test("cursor uses per-model probe fallback and reconnect-fresh", () => {
    const viaAlias = resolveAgentCompat("cursor");
    expect(viaAlias.id).toBe("cursor-agent");
    expect(viaAlias.configDiscovery).toBe("per-model-probe-fallback");
    expect(viaAlias.resume).toBe("reconnect-fresh");
    expect(cursorCompat.configDiscovery).toBe("per-model-probe-fallback");
    expect(cursorCompat.loginArgv).toEqual(["login"]);
    expect(cursorCompat.augmentLaunch).toBeUndefined();
  });

  test("opencode classifyError keeps dedicated auth code", () => {
    const err = opencodeCompat.classifyError?.(
      new Error("Please run opencode auth login"),
      "session-init",
    );
    expect(err?.code).toBe("opencode_auth_required");
    expect(err?.status).toBe(401);
  });

  test("generic classifyError does not use opencode codes", () => {
    const err = resolveAgentCompat("devin").classifyError?.(
      new Error("Unauthorized"),
      "session-init",
    );
    expect(err?.code).toBe("auth_required");
    expect(err?.status).toBe(409);
  });

  test("generic classifyError uses real agent id and advertised methods", () => {
    const err = resolveAgentCompat("gemini").classifyError?.(
      {
        message: "authentication required",
        authMethods: [{ id: "oauth-personal", name: "Google" }],
      },
      "session-init",
    );
    expect(err?.code).toBe("auth_required");
    expect(err?.message).toContain("gemini");
    expect(err?.message).not.toMatch(/^agent requires/);
    const methods = err?.details?.methods as Array<{ id: string }>;
    expect(methods.some((m) => m.id === "oauth-personal")).toBe(true);
    expect(methods.some((m) => m.id === "gemini-login")).toBe(true);
  });

  test("Cursor Internal error is auth_required with cursor_login", () => {
    const err = cursorCompat.classifyError?.(
      { code: -32603, message: "Internal error" },
      "session-init",
    );
    expect(err?.code).toBe("auth_required");
    const methods = err?.details?.methods as Array<{
      id: string;
      externalHint?: string;
    }>;
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.some((m) => m.id === "cursor_login")).toBe(true);
  });

  test("codex alias registers advertised native-load compat", () => {
    const compat = resolveAgentCompat("codex");
    expect(compat.id).toBe("codex-acp");
    expect(compat.configDiscovery).toBe("advertised");
    expect(compat.resume).toBe("native-load");
    expect(compat.normalizeCatalog).toBeTypeOf("function");
  });

  test("qoder uses reconnect-fresh so empty projects skip session/load", () => {
    const compat = resolveAgentCompat("qoder");
    expect(compat.id).toBe("qoder");
    expect(compat.resume).toBe("reconnect-fresh");
    const err = compat.classifyError?.(
      new Error("Please run qodercli-login"),
      "session-init",
    );
    expect(err?.code).toBe("auth_required");
    const methods = err?.details?.methods as Array<{ id: string }> | undefined;
    expect(methods?.some((method) => method.id === "qodercli-login")).toBe(true);
  });

  test("opencode classifyError maps model not found to model_unavailable", () => {
    const err = opencodeCompat.classifyError?.(
      new Error("model not found: structure/openai/gpt-5.6-sol"),
      "config",
    );
    expect(err?.code).toBe("model_unavailable");
  });
});

describe("AgentCompat normalizeCatalog", () => {
  test("codex splits model×effort cartesian product into canonical models + thought", () => {
    const normalized = normalizeAcpSessionConfig({
      models: {
        currentModelId: "gpt-5.6-sol[high]",
        availableModels: [
          { modelId: "gpt-5.6-sol[low]", name: "GPT-5.6-Sol (low)" },
          { modelId: "gpt-5.6-sol[medium]", name: "GPT-5.6-Sol (medium)" },
          { modelId: "gpt-5.6-sol[high]", name: "GPT-5.6-Sol (high)" },
          { modelId: "gpt-5.6-terra[low]", name: "GPT-5.6-Terra (low)" },
          { modelId: "gpt-5.6-terra[high]", name: "GPT-5.6-Terra (high)" },
        ],
      },
      configOptions: [
        {
          id: "reasoning_effort",
          name: "Reasoning Effort",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
        {
          id: "fast-mode",
          name: "Fast Mode",
          currentValue: "false",
          options: [
            { value: "false", name: "Off" },
            { value: "true", name: "On" },
          ],
        },
      ],
    });
    const catalog = applyCompatCatalog("codex-acp", normalized);
    expect(catalog.models?.availableModels?.map((m) => m.modelId)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]);
    expect(catalog.models?.availableModels?.map((m) => m.name)).toEqual([
      "GPT-5.6-Sol",
      "GPT-5.6-Terra",
    ]);
    expect(catalog.models?.currentModelId).toBe("gpt-5.6-sol");
    expect(catalog.thoughtLevels?.configId).toBe("reasoning_effort");
    expect(catalog.thoughtLevels?.currentId).toBe("high");
    expect(catalog.fastOptions?.configId).toBe("fast-mode");
    expect(normalizeCodexCatalog(normalized).models?.currentModelId).toBe(
      "gpt-5.6-sol",
    );
  });

  test("codex synthesizes thoughtLevels when only cartesian models are advertised", () => {
    const catalog = normalizeCodexCatalog({
      models: {
        currentModelId: "gpt-5.6-sol[low]",
        availableModels: [
          { modelId: "gpt-5.6-sol[low]", name: "GPT-5.6-Sol (low)" },
          { modelId: "gpt-5.6-sol[high]", name: "GPT-5.6-Sol (high)" },
        ],
      },
    });
    expect(catalog.thoughtLevels?.configId).toBe("reasoning_effort");
    expect(catalog.thoughtLevels?.currentId).toBe("low");
    expect(catalog.thoughtLevels?.available.map((t) => t.id)).toEqual([
      "low",
      "high",
    ]);
  });

  test("codex keeps persisted thoughtLevels after already-normalized models round-trip", () => {
    const first = normalizeCodexCatalog({
      models: {
        currentModelId: "gpt-5.6-sol[high]",
        availableModels: [
          { modelId: "gpt-5.6-sol[low]", name: "GPT-5.6-Sol (low)" },
          { modelId: "gpt-5.6-sol[high]", name: "GPT-5.6-Sol (high)" },
        ],
      },
    });
    expect(first.models?.availableModels?.map((m) => m.modelId)).toEqual([
      "gpt-5.6-sol",
    ]);
    const stored = applyCompatCatalog("codex-acp", {
      models: first.models,
      thoughtLevels: first.thoughtLevels,
    });
    expect(stored.thoughtLevels?.configId).toBe("reasoning_effort");
    expect(stored.thoughtLevels?.available.map((t) => t.id)).toEqual([
      "low",
      "high",
    ]);
    expect(stored.thoughtLevels?.currentId).toBe("high");
  });

  test("pi lifts Thinking modes into thoughtLevels", () => {
    const catalog = normalizePiCatalog({
      modes: {
        currentModeId: "high",
        availableModes: [
          { id: "off", name: "Thinking: off" },
          { id: "minimal", name: "Thinking: minimal" },
          { id: "low", name: "Thinking: low" },
          { id: "medium", name: "Thinking: medium" },
          { id: "high", name: "Thinking: high" },
          { id: "xhigh", name: "Thinking: xhigh" },
        ],
      },
    });
    expect(catalog.modes).toBeUndefined();
    expect(catalog.thoughtLevels?.configId).toBe(MODE_THOUGHT_CONFIG_ID);
    expect(catalog.thoughtLevels?.currentId).toBe("high");
    expect(catalog.thoughtLevels?.available.map((t) => t.id)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(
      catalog.thoughtLevels?.available.find((t) => t.id === "xhigh")?.name,
    ).toBe("Extra high");
  });

  test("pi keeps real modes when only some entries are thinking", () => {
    const catalog = normalizePiCatalog({
      modes: {
        currentModeId: "build",
        availableModes: [
          { id: "build", name: "Build" },
          { id: "high", name: "Thinking: high" },
        ],
      },
    });
    expect(catalog.modes?.availableModes?.map((m) => m.id)).toEqual(["build"]);
    expect(catalog.thoughtLevels?.available.map((t) => t.id)).toEqual(["high"]);
  });

  test("claude replaces colliding model names with id labels", () => {
    const catalog = normalizeClaudeCatalog({
      models: {
        currentModelId: "opus",
        availableModels: [
          { modelId: "default", name: "deepseek-v4-flash" },
          { modelId: "opus", name: "deepseek-v4-flash" },
          { modelId: "sonnet", name: "deepseek-v4-flash" },
          { modelId: "haiku", name: "deepseek-v4-flash", description: "Fast" },
        ],
      },
    });
    expect(catalog.models?.availableModels?.map((m) => m.name)).toEqual([
      "Default",
      "Opus",
      "Sonnet",
      "Fast",
    ]);
    expect(resolveAgentCompat("claude").normalizeCatalog).toBeTypeOf("function");
  });

  test("claude rewrites only colliding names when Default is unique", () => {
    const catalog = normalizeClaudeCatalog({
      models: {
        currentModelId: "opus",
        availableModels: [
          { modelId: "default", name: "Default (recommended)" },
          { modelId: "opus", name: "deepseek-v4-flash" },
          { modelId: "sonnet", name: "deepseek-v4-flash" },
          { modelId: "haiku", name: "deepseek-v4-flash" },
        ],
      },
    });
    expect(catalog.models?.availableModels?.map((m) => m.name)).toEqual([
      "Default (recommended)",
      "Opus",
      "Sonnet",
      "Haiku",
    ]);
  });

  test("opencode rewrites structure/ category model ids", () => {
    const catalog = normalizeOpenCodeCatalog({
      models: {
        currentModelId: "structure/openai/gpt-5.6-sol",
        availableModels: [
          { modelId: "structure/openai/gpt-5.6-sol", name: "GPT-5.6-Sol" },
          { modelId: "openai/gpt-4.1", name: "GPT-4.1" },
          { modelId: "openai/gpt-5.6-sol", name: "GPT-5.6-Sol" },
          { modelId: "tokenhub/gpt-5.6-sol", name: "structure/GPT 5.6 Sol" },
        ],
      },
    });
    expect(catalog.models?.availableModels?.map((m) => m.modelId)).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-4.1",
      "tokenhub/gpt-5.6-sol",
    ]);
    expect(
      catalog.models?.availableModels?.find(
        (model) => model.modelId === "tokenhub/gpt-5.6-sol",
      )?.name,
    ).toBe("GPT 5.6 Sol");
    expect(catalog.models?.currentModelId).toBe("openai/gpt-5.6-sol");
  });
});

