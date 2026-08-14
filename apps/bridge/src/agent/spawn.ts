/**
 * Build ACP provider options for any resolved agent launch command.
 */
import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import { BridgeError } from "../errors.ts";
import { resolveAgentCompat } from "./compat/registry.ts";
import { resolveLaunchCommand } from "./detect.ts";

function cleanEnv(
  extra?: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    ...extra,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v === "string") out[k] = v;
  }
  if (!out.PATH && process.env.PATH) out.PATH = process.env.PATH;
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

  const provider = createACPProvider({
    command,
    args: patch?.args ?? args,
    session: { cwd: input.cwd, mcpServers: [] },
    existingSessionId:
      compat.resume === "native-load" ? input.existingSessionId : undefined,
    persistSession: input.persistSession ?? true,
    env: cleanEnv(envExtra),
  });

  return {
    agentId: launch.agentId,
    command: launch.command,
    provider,
  };
}
