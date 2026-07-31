type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function permissionRuleForAsk(
  value: unknown,
  globalFallback?: unknown,
): unknown {
  if (value === "deny") return "deny";
  if (!isObject(value)) return globalFallback === "deny" ? "deny" : "ask";

  // Preserve explicit granular allow/deny rules, but make the fallback ask.
  const { "*": fallback, ...specific } = value;
  return {
    "*": fallback === "deny" ||
      (fallback === undefined && globalFallback === "deny")
      ? "deny"
      : "ask",
    ...specific,
  };
}

/**
 * Force mutation and shell tools through ACP requestPermission without changing
 * a user's project/global config on disk. Auto mode is implemented by the
 * Bridge selecting an allow option in the resulting callback.
 */
export function buildOpenCodeConfigContent(existing?: string): string {
  let config: JsonObject = {};
  if (existing?.trim()) {
    const parsed = JSON.parse(existing) as unknown;
    if (!isObject(parsed)) {
      throw new Error("OPENCODE_CONFIG_CONTENT must contain a JSON object");
    }
    config = parsed;
  }

  const currentPermission = config.permission;
  if (currentPermission === "deny") {
    return JSON.stringify({ ...config, permission: "deny" });
  }

  const permission: JsonObject = isObject(currentPermission)
    ? { ...currentPermission }
    : currentPermission === "ask"
      ? { "*": "ask" }
      : currentPermission === "allow"
        ? { "*": "allow" }
        : {};

  const globalFallback = permission["*"];
  permission.edit = permissionRuleForAsk(permission.edit, globalFallback);
  permission.bash = permissionRuleForAsk(permission.bash, globalFallback);
  permission.external_directory = permissionRuleForAsk(
    permission.external_directory,
    globalFallback,
  );

  return JSON.stringify({ ...config, permission });
}
