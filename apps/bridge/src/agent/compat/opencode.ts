import { BridgeError } from "../../errors.ts";
import { buildOpenCodeConfigContent } from "../../opencode-config.ts";
import { classifyGenericAgentError } from "./generic-acp.ts";
import type { NormalizedAcpSessionConfig } from "../../acp-session-config.ts";
import type { AgentCompat, NormalizedAgentError } from "./types.ts";
import { errorText, inspectAgentError } from "./types.ts";

const OPENCODE_CATEGORY_PREFIX = /^(structure|recent|favorites|custom)\//;

/**
 * OpenCode grouped catalogs can leak category paths like
 * `structure/openai/gpt-5.6-sol`. Strip those prefixes; ACP set_model wants
 * `provider/model`.
 */
export function normalizeOpenCodeCatalog(
  cfg: NormalizedAcpSessionConfig,
): NormalizedAcpSessionConfig {
  const available = cfg.models?.availableModels ?? [];
  if (available.length === 0) return cfg;

  const rewritten = available.map((model) => {
    const modelId = OPENCODE_CATEGORY_PREFIX.test(model.modelId)
      ? model.modelId.replace(OPENCODE_CATEGORY_PREFIX, "")
      : model.modelId;
    const name =
      typeof model.name === "string" && OPENCODE_CATEGORY_PREFIX.test(model.name)
        ? model.name.replace(OPENCODE_CATEGORY_PREFIX, "")
        : model.name;
    if (modelId === model.modelId && name === model.name) return model;
    return { ...model, modelId, ...(name !== undefined ? { name } : {}) };
  });

  const seen = new Set<string>();
  const unique = rewritten.filter((model) => {
    if (!model.modelId || seen.has(model.modelId)) return false;
    seen.add(model.modelId);
    return true;
  });

  let currentModelId = cfg.models?.currentModelId;
  if (currentModelId && OPENCODE_CATEGORY_PREFIX.test(currentModelId)) {
    currentModelId = currentModelId.replace(OPENCODE_CATEGORY_PREFIX, "");
  }
  if (currentModelId && !seen.has(currentModelId)) {
    currentModelId = unique[0]?.modelId;
  }

  return {
    ...cfg,
    models: {
      currentModelId,
      availableModels: unique,
    },
  };
}

export const opencodeCompat: AgentCompat = {
  id: "opencode",
  configDiscovery: "per-model-probe-fallback",
  resume: "native-load",
  normalizeCatalog: normalizeOpenCodeCatalog,
  augmentLaunch() {
    try {
      return {
        env: {
          OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(
            process.env.OPENCODE_CONFIG_CONTENT,
          ),
        },
      };
    } catch (err) {
      throw new BridgeError(
        "invalid_opencode_config",
        err instanceof Error ? err.message : String(err),
        500,
      );
    }
  },
  classifyError(error, phase): NormalizedAgentError | null {
    const kind = inspectAgentError(error);
    const cause = errorText(error);
    const details = { cause, agentId: "opencode" };
    if (kind === "auth") {
      return {
        code: "opencode_auth_required",
        message:
          phase === "chat"
            ? "OpenCode requires authentication"
            : "OpenCode requires authentication. Run `opencode auth login` (or your provider login), then retry.",
        status: 401,
        details: { ...details, methods: [], agentName: "opencode" },
      };
    }
    if (kind === "spawn") {
      return {
        code: "opencode_spawn_failed",
        message:
          "Failed to start the opencode ACP process. Check the install / PATH and retry.",
        status: 502,
        details,
      };
    }
    return classifyGenericAgentError(error, phase, "opencode");
  },
};
