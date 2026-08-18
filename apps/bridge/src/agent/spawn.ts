/**
 * Build ACP provider options for any resolved agent launch command.
 */
import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import { BridgeError } from "../errors.ts";
import { acpInitializeFromCompat } from "./compat/types.ts";
import { resolveAgentCompat } from "./compat/registry.ts";
import { resolveLaunchCommand } from "./detect.ts";

const SPAWN_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "ACP_AI_PROVIDER_DEBUG",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
] as const;

/** Subprocess env: allowlisted parent keys plus launch/compat extras. */
export function cleanEnv(
  extra?: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const key of SPAWN_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string") out[key] = value;
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value === "string") out[key] = value;
    }
  }
  if (!out.PATH && process.env.PATH) out.PATH = process.env.PATH;
  if (!out.HOME && process.env.HOME) out.HOME = process.env.HOME;
  return Object.keys(out).length ? out : undefined;
}

export type SpawnAgentInput = {
  cwd: string;
  agentId?: string;
  agentCommand?: string[];
  existingSessionId?: string;
  persistSession?: boolean;
};

export type SpawnedAgent = {
  agentId: string;
  command: string[];
  provider: ACPProvider;
};

export function spawnAgentProvider(input: SpawnAgentInput): SpawnedAgent {
  let launch;
  try {
    launch = resolveLaunchCommand({
      agentId: input.agentId,
      agentCommand: input.agentCommand,
    });
  } catch (err) {
    if (err instanceof BridgeError) throw err;
    throw new BridgeError(
      "agent_unavailable",
      err instanceof Error ? err.message : String(err),
      400,
    );
  }

  const [command, ...args] = launch.command;
  if (!command) {
    throw new BridgeError(
      "agent_unavailable",
      "Resolved agent command is empty",
      400,
    );
  }

  const compat = resolveAgentCompat(launch.agentId);
  const envExtra: Record<string, string | undefined> = {
    ACP_AI_PROVIDER_DEBUG: process.env.ACP_AI_PROVIDER_DEBUG,
    ...(launch.env ?? {}),
  };
  const patch = compat.augmentLaunch?.({
    cwd: input.cwd,
    agentId: launch.agentId,
    command: launch.command,
    env: Object.fromEntries(
      Object.entries(envExtra).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    existingSessionId: input.existingSessionId,
    persistSession: input.persistSession ?? true,
  });
  if (patch?.env) Object.assign(envExtra, patch.env);

  const initialize = acpInitializeFromCompat(compat);
  const provider = createACPProvider({
    command,
    args: patch?.args ?? args,
    session: { cwd: input.cwd, mcpServers: [] },
    existingSessionId:
      compat.resume === "native-load" ? input.existingSessionId : undefined,
    persistSession: input.persistSession ?? true,
    env: cleanEnv(envExtra),
    ...(initialize ? { initialize } : {}),
  });

  return {
    agentId: launch.agentId,
    command: launch.command,
    provider,
  };
}
