import type { NormalizedAcpSessionConfig } from "../../acp-session-config.ts";
import {
  restrictThoughtState,
  splitThinkingToggleFromThought,
  stripEffortFromModelName,
  thoughtStateFromIds,
} from "../../acp-session-config.ts";
import { classifyGenericAgentError } from "./generic-acp.ts";
import type { AgentCompat, AgentPhase, NormalizedAgentError } from "./types.ts";
import {
  errorText,
  extractAuthMethods,
  inspectAgentError,
  mergeAuthMethods,
} from "./types.ts";

const CURSOR_LOGIN_METHOD = {
  id: "cursor_login",
  type: "cursor_login",
  name: "Cursor Login",
  description: "Sign in with your Cursor account in the browser.",
};

const VARIANT_RE = /^(.*)\[([^\]]+)\]$/;

const REASONING_KEYS = new Set(["reasoning", "thought", "effort"]);
const THINKING_KEYS = new Set([
  "thinking",
  "thinking_enabled",
  "think_enabled",
]);
const FAST_TRUE = new Set(["true", "1", "yes", "on", "fast"]);
const FAST_FALSE = new Set(["false", "0", "no", "off"]);
const THINKING_ON = new Set(["true", "1", "yes", "on"]);
const THINKING_OFF = new Set(["false", "0", "no", "off", "none"]);

const CONTEXT_KEYS = new Set([
  "context",
  "context_length",
  "context_window",
  "ctx",
]);

type CursorVariant = {
  canonicalId: string;
  reasoning?: string;
  fast?: string;
  context?: string;
  thinking?: string;
};

function normalizeFastValue(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (FAST_TRUE.has(key)) return "true";
  if (FAST_FALSE.has(key)) return "false";
  return raw.trim();
}

function fastDisplayName(id: string): string {
  if (id === "true") return "On";
  if (id === "false") return "Off";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function thinkingDisplayName(id: string): string {
  const key = id.trim().toLowerCase();
  if (THINKING_ON.has(key) || key === "on") return "On";
  if (THINKING_OFF.has(key)) return "Off";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function contextDisplayName(id: string): string {
  return id.trim() || id;
}

function normalizeThinkingValue(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (THINKING_ON.has(key)) return "on";
  if (THINKING_OFF.has(key)) return key === "none" ? "none" : "off";
  return raw.trim();
}

function isBooleanishValue(raw: string): boolean {
  const key = raw.trim().toLowerCase();
  return (
    FAST_TRUE.has(key) ||
    FAST_FALSE.has(key) ||
    THINKING_ON.has(key) ||
    THINKING_OFF.has(key)
  );
}

function pushUnique(list: string[], value: string | undefined): void {
  if (!value || list.includes(value)) return;
  list.push(value);
}

/**
 * Cursor variants: `composer-2.5[fast=true]` or
 * `gpt-5.5[context=272k,reasoning=medium,fast=false]`. Bare `[high]` is reasoning.
 */
export function splitCursorVariantId(modelId: string): CursorVariant | null {
  const match = modelId.match(VARIANT_RE);
  if (!match) return null;
  const canonicalId = match[1]!.trim();
  const inner = match[2]!.trim();
  if (!canonicalId || !inner) return null;

  if (!inner.includes("=")) {
    const key = inner.toLowerCase();
    if (FAST_TRUE.has(key) || key === "fast") {
      return { canonicalId, fast: "true" };
    }
    if (FAST_FALSE.has(key)) {
      return { canonicalId, fast: "false" };
    }
    return { canonicalId, reasoning: inner };
  }

  let reasoning: string | undefined;
  let fast: string | undefined;
  let context: string | undefined;
  let thinking: string | undefined;
  for (const part of inner.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim().toLowerCase();
    const v = part.slice(eq + 1).trim();
    if (!k || !v) continue;
    if (THINKING_KEYS.has(k)) {
      if (isBooleanishValue(v)) thinking = normalizeThinkingValue(v);
      else reasoning = v;
    } else if (REASONING_KEYS.has(k)) reasoning = v;
    else if (k === "fast") fast = normalizeFastValue(v);
    else if (CONTEXT_KEYS.has(k)) context = v;
  }
  if (!reasoning && !fast && !context && !thinking) return null;
  return { canonicalId, reasoning, fast, context, thinking };
}

function stripCursorVariantName(name: string, variant: CursorVariant): string {
  let out = name.trim();
  const tokens = [
    variant.reasoning,
    variant.fast,
    variant.context,
    variant.thinking,
    variant.fast === "true" ? "Fast" : undefined,
    variant.reasoning ? `reasoning=${variant.reasoning}` : undefined,
    variant.fast ? `fast=${variant.fast}` : undefined,
    variant.context ? `context=${variant.context}` : undefined,
    variant.thinking ? `thinking=${variant.thinking}` : undefined,
  ].filter((token): token is string => Boolean(token));
  for (const token of tokens) {
    out = stripEffortFromModelName(out, token);
  }
  return out || name.trim();
}

/**
 * Collapse Cursor cartesian / parameterized variant ids into canonical models
 * plus thought/fast pickers. Keep advertised thought/fast when present.
 */
export function normalizeCursorCatalog(
  cfg: NormalizedAcpSessionConfig,
): NormalizedAcpSessionConfig {
  const available = cfg.models?.availableModels ?? [];
  if (available.length === 0) return cfg;

  type CanonicalEntry = {
    name: string;
    description?: string;
    reasoning: string[];
    fast: string[];
    context: string[];
    thinking: string[];
  };

  const canonicalOrder: string[] = [];
  const byCanonical = new Map<string, CanonicalEntry>();
  let sawVariant = false;

  for (const model of available) {
    const split = splitCursorVariantId(model.modelId);
    if (!split) {
      if (!byCanonical.has(model.modelId)) {
        canonicalOrder.push(model.modelId);
        byCanonical.set(model.modelId, {
          name: model.name?.trim() || model.modelId,
          description: model.description,
          reasoning: [],
          fast: [],
          context: [],
          thinking: [],
        });
      }
      continue;
    }
    sawVariant = true;
    let entry = byCanonical.get(split.canonicalId);
    if (!entry) {
      canonicalOrder.push(split.canonicalId);
      entry = {
        name: stripCursorVariantName(
          model.name?.trim() || split.canonicalId,
          split,
        ),
        description: model.description,
        reasoning: [],
        fast: [],
        context: [],
        thinking: [],
      };
      byCanonical.set(split.canonicalId, entry);
    }
    pushUnique(entry.reasoning, split.reasoning);
    pushUnique(entry.fast, split.fast);
    pushUnique(entry.context, split.context);
    pushUnique(entry.thinking, split.thinking);
  }

  if (!sawVariant) {
    const split = splitThinkingToggleFromThought(cfg);
    if (
      split.thoughtLevels === cfg.thoughtLevels &&
      split.thinkingOptions === cfg.thinkingOptions
    ) {
      return cfg;
    }
    return {
      ...cfg,
      thoughtLevels: split.thoughtLevels,
      thinkingOptions: split.thinkingOptions,
    };
  }

  const currentSplit = cfg.models?.currentModelId
    ? splitCursorVariantId(cfg.models.currentModelId)
    : null;
  const currentModelId =
    currentSplit?.canonicalId ??
    (cfg.models?.currentModelId && byCanonical.has(cfg.models.currentModelId)
      ? cfg.models.currentModelId
      : canonicalOrder[0]);
  const currentEntry = currentModelId
    ? byCanonical.get(currentModelId)
    : undefined;

  const thoughtLevels = restrictThoughtState(
    cfg.thoughtLevels,
    currentEntry?.reasoning ?? [],
    currentSplit?.reasoning ?? cfg.thoughtLevels?.currentId,
    "reasoning",
  );
  const fastOptions =
    restrictThoughtState(
      cfg.fastOptions,
      currentEntry?.fast ?? [],
      currentSplit?.fast ?? cfg.fastOptions?.currentId,
      "fast",
    ) ??
    thoughtStateFromIds(
      cfg.fastOptions?.configId ?? "fast",
      currentSplit?.fast,
      currentEntry?.fast ?? [],
      fastDisplayName,
    );
  const contextOptions =
    restrictThoughtState(
      cfg.contextOptions,
      currentEntry?.context ?? [],
      currentSplit?.context ?? cfg.contextOptions?.currentId,
      "context",
    ) ??
    thoughtStateFromIds(
      cfg.contextOptions?.configId ?? "context",
      currentSplit?.context,
      currentEntry?.context ?? [],
      contextDisplayName,
    );
  const thinkingFromVariant =
    thoughtStateFromIds(
      cfg.thinkingOptions?.configId ?? "thinking",
      currentSplit?.thinking ?? cfg.thinkingOptions?.currentId,
      currentEntry?.thinking ?? [],
      thinkingDisplayName,
    ) ?? cfg.thinkingOptions;
  const currentSplitAxes = splitThinkingToggleFromThought({
    thoughtLevels,
    thinkingOptions: thinkingFromVariant,
  });

  const modelConfigById: NonNullable<
    NormalizedAcpSessionConfig["modelConfigById"]
  > = { ...cfg.modelConfigById };
  for (const [modelId, entry] of byCanonical) {
    const thought = restrictThoughtState(
      cfg.thoughtLevels,
      entry.reasoning,
      modelId === currentModelId ? currentSplit?.reasoning : undefined,
      "reasoning",
    );
    const thinking = thoughtStateFromIds(
      cfg.thinkingOptions?.configId ?? "thinking",
      modelId === currentModelId ? currentSplit?.thinking : undefined,
      entry.thinking,
      thinkingDisplayName,
    );
    const split = splitThinkingToggleFromThought({
      thoughtLevels: thought,
      thinkingOptions: thinking,
    });
    const axes = {
      thoughtLevels: split.thoughtLevels,
      fastOptions: thoughtStateFromIds(
        cfg.fastOptions?.configId ?? "fast",
        modelId === currentModelId ? currentSplit?.fast : undefined,
        entry.fast,
        fastDisplayName,
      ),
      contextOptions: thoughtStateFromIds(
        cfg.contextOptions?.configId ?? "context",
        modelId === currentModelId ? currentSplit?.context : undefined,
        entry.context,
        contextDisplayName,
      ),
      thinkingOptions: split.thinkingOptions,
    };
    if (
      axes.thoughtLevels ||
      axes.fastOptions ||
      axes.contextOptions ||
      axes.thinkingOptions
    ) {
      modelConfigById[modelId] = axes;
    }
  }

  return {
    ...cfg,
    models: {
      currentModelId,
      availableModels: canonicalOrder.map((modelId) => {
        const entry = byCanonical.get(modelId)!;
        return {
          modelId,
          name: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
        };
      }),
    },
    thoughtLevels: currentSplitAxes.thoughtLevels ?? cfg.thoughtLevels,
    fastOptions: fastOptions ?? cfg.fastOptions,
    contextOptions: contextOptions ?? cfg.contextOptions,
    thinkingOptions: currentSplitAxes.thinkingOptions ?? cfg.thinkingOptions,
    modelConfigById:
      Object.keys(modelConfigById).length > 0 ? modelConfigById : undefined,
  };
}

function withCursorLoginMethods(
  classified: NormalizedAgentError,
  error: unknown,
): NormalizedAgentError {
  const methods = mergeAuthMethods(
    extractAuthMethods(error),
    classified.details?.methods,
    [CURSOR_LOGIN_METHOD],
  );
  return {
    ...classified,
    details: {
      ...classified.details,
      cause: errorText(error),
      agentId: "cursor-agent",
      agentName: "cursor-agent",
      methods,
    },
  };
}

function cursorAuthError(
  error: unknown,
  phase: AgentPhase,
): NormalizedAgentError {
  return {
    code: "auth_required",
    message:
      phase === "chat"
        ? "cursor-agent requires authentication"
        : "cursor-agent requires authentication. Sign in with your Cursor account, then retry.",
    status: 409,
    details: {
      cause: errorText(error),
      agentId: "cursor-agent",
      agentName: "cursor-agent",
      methods: [CURSOR_LOGIN_METHOD],
    },
  };
}

function shouldTreatCursorAsAuth(error: unknown, phase: AgentPhase): boolean {
  if (inspectAgentError(error) === "auth") return true;
  if (phase !== "launch" && phase !== "session-init") return false;
  const text = errorText(error).toLowerCase();
  if (
    text.includes("no previous sessions found") ||
    text.includes("session not found") ||
    text.includes("unknown session")
  ) {
    return false;
  }
  if (/\binternal error\b/.test(text)) return true;
  return /not logged in|please (run )?agent login|missing login|no login/.test(
    text,
  );
}

export const cursorCompat: AgentCompat = {
  id: "cursor-agent",
  configDiscovery: "per-model-probe-fallback",
  resume: "reconnect-fresh",
  loginArgv: ["login"],
  initializeMeta: { parameterizedModelPicker: true },
  normalizeCatalog: normalizeCursorCatalog,
  classifyError(error, phase) {
    const kind = inspectAgentError(error);
    if (kind && kind !== "auth") {
      return classifyGenericAgentError(error, phase, "cursor-agent");
    }
    const generic = classifyGenericAgentError(error, phase, "cursor-agent");
    if (generic?.code === "auth_required") {
      return withCursorLoginMethods(generic, error);
    }
    if (shouldTreatCursorAsAuth(error, phase)) {
      return withCursorLoginMethods(cursorAuthError(error, phase), error);
    }
    return generic;
  },
};
