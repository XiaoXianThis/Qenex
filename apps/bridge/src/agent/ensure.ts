import {
  authHintFor,
  canonicalAgentId,
  evaluateAgentStatus,
  probeLaunchCommand,
  resolveKnownAgent,
} from "./detect.ts";
import {
  getInstalled,
  installAgentWithProgress,
  uninstallAgent,
} from "./install.ts";
import { findRegistryAgent } from "./registry.ts";
import type { EnsureReadyResult, ProgressEmit } from "./types.ts";

function stage(emit: ProgressEmit | undefined, stageName: string, message: string) {
  emit?.({ type: "stage", stage: stageName, message });
}

function finalizeReady(
  agentId: string,
  command: string[],
  source: EnsureReadyResult["source"],
  skippedDownload: boolean,
  updateAvailable: boolean,
  emit?: ProgressEmit,
): EnsureReadyResult {
  stage(emit, "probe", "Verifying launch command…");
  probeLaunchCommand(command);
  const authHint = authHintFor(agentId);
  const readiness = authHint ? "needAuth" : "ready";
  if (authHint) {
    stage(emit, "auth", authHint);
  } else {
    stage(emit, "ready", "Agent is ready to use");
  }
  return {
    agentId,
    readiness,
    skippedDownload,
    source,
    updateAvailable,
    resolvedCommand: command,
    installed: getInstalled(agentId),
    authHint,
    detail: null,
  };
}

export async function ensureAgentReadyOpts(
  agentId: string,
  preferUpdate = false,
  forceInstall = false,
  emit?: ProgressEmit,
): Promise<EnsureReadyResult> {
  const id = canonicalAgentId(agentId);
  if (!id) throw new Error("agentId is required");

  stage(emit, "detect", `Checking whether '${id}' is already available…`);

  const registryAgent = await findRegistryAgent(id, false).catch(() => null);
  const status = registryAgent ? evaluateAgentStatus(registryAgent) : null;
  const updateAvailable = status?.updateAvailable ?? false;

  const resolved = resolveKnownAgent(id);
  if (
    resolved &&
    !forceInstall &&
    !(preferUpdate && updateAvailable)
  ) {
    stage(emit, "skipped", "Using existing local agent");
    return finalizeReady(
      id,
      resolved.command,
      resolved.source,
      true,
      updateAvailable,
      emit,
    );
  }

  if (preferUpdate && !forceInstall && !updateAvailable && resolved) {
    stage(emit, "skipped", "Already up to date");
    return finalizeReady(
      id,
      resolved.command,
      resolved.source,
      true,
      false,
      emit,
    );
  }

  if (status?.readiness === "unavailable" && !status.installable) {
    throw new Error(status.detail || `Agent '${id}' is unavailable on this platform`);
  }

  stage(emit, "install", `Installing '${id}'…`);
  const installed = await installAgentWithProgress(id, emit);
  const after = resolveKnownAgent(id);
  if (!after) {
    try {
      uninstallAgent(id);
    } catch {
      /* ignore */
    }
    throw new Error(`Installed '${id}' but could not resolve a launch command`);
  }
  try {
    probeLaunchCommand(after.command);
  } catch (err) {
    try {
      uninstallAgent(id);
    } catch {
      /* ignore */
    }
    throw err;
  }

  return finalizeReady(
    id,
    after.command,
    "managed",
    false,
    false,
    emit,
  );
}
