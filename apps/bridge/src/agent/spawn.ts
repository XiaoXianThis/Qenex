/**
 * Build ACP provider options for any resolved agent launch command.
 */
import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import { BridgeError } from "../errors.ts";
import { buildOpenCodeConfigContent } from "../opencode-config.ts";
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

  const envExtra: Record<string, string | undefined> = {
    ACP_AI_PROVIDER_DEBUG: process.env.ACP_AI_PROVIDER_DEBUG,
    ...(launch.env ?? {}),
  };

  // OpenCode-only inline permission / config injection.
  if (launch.agentId === "opencode") {
    try {
      envExtra.OPENCODE_CONFIG_CONTENT = buildOpenCodeConfigContent(
        process.env.OPENCODE_CONFIG_CONTENT,
      );
    } catch (err) {
      throw new BridgeError(
        "invalid_opencode_config",
        err instanceof Error ? err.message : String(err),
        500,
      );
    }
  }

  const provider = createACPProvider({
    command,
    args,
    session: { cwd: input.cwd, mcpServers: [] },
    existingSessionId: input.existingSessionId,
    persistSession: input.persistSession ?? true,
    env: cleanEnv(envExtra),
  });

  return {
    agentId: launch.agentId,
    command: launch.command,
    provider,
  };
}
