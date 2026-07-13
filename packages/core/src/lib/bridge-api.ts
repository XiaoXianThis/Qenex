import {
  EMPTY_SESSION_CONFIG,
  parseSessionOptions,
  type SessionConfig,
  type SessionOption,
} from "./session-config.ts";
import type { AguiEvent } from "./bridge-agent.ts";
import type { ApprovalState } from "../store/approval-store.ts";

export type ApprovalResponse = {
  success: boolean;
  callId: string;
};

export type EnsureSessionRequest = {
  taskId: string;
  cwd: string;
  /** Bridge detect/spawn id (registry id preferred). */
  agentId?: string;
  /** Optional override; omit/empty to let Bridge resolve from agentId. */
  agentCommand?: string[];
  title?: string;
  mode?: string;
  model?: string;
  resumeSessionId?: string;
  /** off | inplace | worktree | snapshot — locked for this task at create. */
  gitSessionMode?: string;
};

export type EnsureSessionResult = {
  config: SessionConfig;
  agentSessionId: string;
  taskId: string;
};

export type EnsureSessionResponse = {
  taskId: string;
  agentSessionId: string;
  modes?: unknown;
  models?: unknown;
  currentModeId?: string;
  thoughtLevels?: unknown;
  thoughtLevelConfigId?: string;
  currentThoughtLevelId?: string;
  currentModelId?: string;
};

export type SessionConfigResponse = {
  modes?: unknown;
  models?: unknown;
  currentModeId?: string;
  thoughtLevels?: unknown;
  thoughtLevelConfigId?: string;
  currentThoughtLevelId?: string;
  currentModelId?: string;
};

export type TaskSummary = {
  taskId: string;
  agentSessionId: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  agentId?: string | null;
  currentRunId?: string | null;
};

export type TaskListResponse = {
  tasks: TaskSummary[];
};

export type PollEventsResponse = {
  events: AguiEvent[];
  afterId: number;
  done: boolean;
  runId?: string | null;
};

import { fetchJson, bridgeFetch } from "./bridge-client.ts";

function toSessionConfig(
  payload: EnsureSessionResponse | SessionConfigResponse,
  ready = true,
): SessionConfig {
  const modes = parseSessionOptions(payload.modes);
  const models = parseSessionOptions(payload.models);
  const thoughtLevels = parseSessionOptions(payload.thoughtLevels);

  return {
    modes,
    models,
    thoughtLevels,
    currentModeId:
      payload.currentModeId ??
      modes[0]?.id ??
      null,
    currentModelId:
      payload.currentModelId ??
      models[0]?.id ??
      null,
    currentThoughtLevelId:
      payload.currentThoughtLevelId ??
      thoughtLevels[0]?.id ??
      null,
    thoughtLevelConfigId: payload.thoughtLevelConfigId ?? null,
    ready,
    loading: false,
    error: null,
    authChallenge: null,
  };
}

export async function ensureSession(
  request: EnsureSessionRequest,
): Promise<EnsureSessionResult> {
  const response = await fetchJson<EnsureSessionResponse>("/v2/tasks", {
    method: "POST",
    body: JSON.stringify({
      taskId: request.taskId,
      cwd: request.cwd,
      title: request.title ?? "AG-UI Session",
      agentId: request.agentId,
      agentCommand:
        request.agentCommand && request.agentCommand.length > 0
          ? request.agentCommand
          : undefined,
      mode: request.mode,
      model: request.model,
      resumeSessionId: request.resumeSessionId,
      gitSessionMode: request.gitSessionMode,
    }),
  });
  return {
    config: toSessionConfig(response),
    agentSessionId: response.agentSessionId,
    taskId: response.taskId,
  };
}

export async function getSessionConfig(
  taskId: string,
): Promise<SessionConfig> {
  const response = await fetchJson<SessionConfigResponse>(
    `/v2/tasks/${taskId}/config`,
  );
  return toSessionConfig(response);
}

export async function setMode(
  taskId: string,
  modeId: string,
): Promise<SessionConfig> {
  await fetchJson(`/v2/tasks/${taskId}/mode`, {
    method: "POST",
    body: JSON.stringify({ modeId }),
  });
  return getSessionConfig(taskId);
}

export async function setModel(
  taskId: string,
  modelId: string,
): Promise<SessionConfig> {
  await fetchJson(`/v2/tasks/${taskId}/model`, {
    method: "POST",
    body: JSON.stringify({ modelId }),
  });
  return getSessionConfig(taskId);
}

export async function setConfigOption(
  taskId: string,
  configId: string,
  value: string,
): Promise<SessionConfig> {
  await fetchJson(`/v2/tasks/${taskId}/config-option`, {
    method: "POST",
    body: JSON.stringify({ configId, value }),
  });
  return getSessionConfig(taskId);
}

export async function sendApproval(
  taskId: string,
  callId: string,
  approved: boolean,
  optionId?: string,
): Promise<ApprovalResponse> {
  return fetchJson<ApprovalResponse>(`/v2/tasks/${taskId}/approval`, {
    method: "POST",
    body: JSON.stringify({
      callId,
      approved,
      optionId: optionId ?? null,
    }),
  });
}

/** Live pending approval (Bridge waiters) — used to restore UI after refresh. */
export async function getPendingApproval(taskId: string): Promise<ApprovalState> {
  return fetchJson<ApprovalState>(`/v2/tasks/${taskId}/approval`);
}

export async function listTasks(): Promise<TaskListResponse> {
  return fetchJson<TaskListResponse>("/v2/tasks");
}

export async function getTaskStatus(taskId: string): Promise<TaskSummary> {
  return fetchJson<TaskSummary>(`/v2/tasks/${taskId}/status`);
}

export async function pollTaskEvents(
  taskId: string,
  options?: { runId?: string; afterId?: number },
): Promise<PollEventsResponse> {
  const params = new URLSearchParams();
  if (options?.runId) params.set("runId", options.runId);
  if (options?.afterId != null) params.set("afterId", String(options.afterId));
  const query = params.toString();
  return fetchJson<PollEventsResponse>(
    `/v2/tasks/${taskId}/events/poll${query ? `?${query}` : ""}`,
  );
}

export async function getTaskTitle(taskId: string): Promise<string | null> {
  const { tasks } = await listTasks();
  return tasks.find((task) => task.taskId === taskId)?.title ?? null;
}

export async function updateTaskTitle(
  taskId: string,
  title: string,
): Promise<void> {
  await fetchJson(`/v2/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  await fetchJson(`/v2/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export type ProbeAgentResponse = {
  available: boolean;
  resolved?: string;
  command?: string[];
  detail?: string;
};

export async function probeAgent(input: {
  agentId?: string;
  agentCommand?: string[];
}): Promise<ProbeAgentResponse> {
  return fetchJson<ProbeAgentResponse>("/v2/agents/probe", {
    method: "POST",
    body: JSON.stringify({
      agentId: input.agentId,
      agentCommand:
        input.agentCommand && input.agentCommand.length > 0
          ? input.agentCommand
          : undefined,
    }),
  });
}

export type AgentInstallKind = "binary" | "npx" | "uvx";
export type AgentReadiness =
  | "ready"
  | "needAdapter"
  | "needAuth"
  | "install"
  | "unavailable";
export type AgentDistributionClass = "native" | "adapter";
export type AgentDetectedSource = "path" | "vendor" | "managed" | "none";

export type InstalledAgentInfo = {
  agentId: string;
  name: string;
  version: string;
  kind: AgentInstallKind;
  command: string[];
  env?: Record<string, string>;
  installPath: string;
  installedAt: number;
};

export type RegistryAgentEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  repository?: string | null;
  website?: string | null;
  authors?: string[];
  license?: string | null;
  icon?: string | null;
  platform: string;
  installable: boolean;
  preferredKind?: AgentInstallKind | null;
  distributionClass?: AgentDistributionClass;
  readiness?: AgentReadiness;
  detected?: AgentDetectedSource;
  resolvedCommand?: string[] | null;
  detail?: string | null;
  authHint?: string | null;
  installed?: InstalledAgentInfo | null;
  updateAvailable: boolean;
};

export type DiscoveredAgentEntry = {
  id: string;
  name: string;
  version: string;
  readiness: AgentReadiness;
  detected: AgentDetectedSource;
  resolvedCommand?: string[] | null;
  updateAvailable: boolean;
  detail?: string | null;
  authHint?: string | null;
  icon?: string | null;
};

export type DiscoverAgentsResponse = {
  agents: DiscoveredAgentEntry[];
};

export type EnsureReadyResult = {
  agentId: string;
  readiness: AgentReadiness;
  skippedDownload: boolean;
  source: AgentDetectedSource;
  updateAvailable: boolean;
  resolvedCommand?: string[] | null;
  installed?: InstalledAgentInfo | null;
  authHint?: string | null;
  detail?: string | null;
};

export type AgentRegistryResponse = {
  version: string;
  platform: string;
  agents: RegistryAgentEntry[];
};

export type InstalledAgentsResponse = {
  agents: InstalledAgentInfo[];
};

export async function fetchAgentRegistry(
  refresh = false,
): Promise<AgentRegistryResponse> {
  const query = refresh ? "?refresh=true" : "";
  return fetchJson<AgentRegistryResponse>(`/v2/agents/registry${query}`);
}

export async function listInstalledAgents(): Promise<InstalledAgentsResponse> {
  return fetchJson<InstalledAgentsResponse>("/v2/agents/installed");
}

export async function installAgent(
  agentId: string,
): Promise<InstalledAgentInfo> {
  return fetchJson<InstalledAgentInfo>("/v2/agents/install", {
    method: "POST",
    body: JSON.stringify({ agentId }),
  });
}

export type InstallProgressEvent =
  | {
      type: "stage";
      stage: string;
      message: string;
    }
  | {
      type: "download";
      message: string;
      url?: string;
      downloadedBytes: number;
      totalBytes?: number | null;
    }
  | {
      type: "done";
      agent?: InstalledAgentInfo;
      result?: EnsureReadyResult;
    }
  | {
      type: "error";
      detail: string;
    };

export async function discoverLocalAgents(
  refresh = false,
): Promise<DiscoverAgentsResponse> {
  const query = refresh ? "?refresh=true" : "";
  return fetchJson<DiscoverAgentsResponse>(`/v2/agents/discover${query}`);
}

export async function ensureAgentReady(
  agentId: string,
  options?: { preferUpdate?: boolean; forceInstall?: boolean },
): Promise<EnsureReadyResult> {
  return fetchJson<EnsureReadyResult>("/v2/agents/ensure-ready", {
    method: "POST",
    body: JSON.stringify({
      agentId,
      preferUpdate: options?.preferUpdate ?? false,
      forceInstall: options?.forceInstall ?? false,
    }),
  });
}

function parseSseChunk(
  buffer: string,
): { events: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: string[] = [];
  for (const part of parts) {
    const dataLines = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length > 0) {
      events.push(dataLines.join("\n"));
    }
  }
  return { events, rest };
}

async function readInstallProgressStream(
  path: string,
  onProgress?: (event: InstallProgressEvent) => void,
): Promise<InstallProgressEvent & { type: "done" }> {
  let response: Response;
  try {
    response = await bridgeFetch(path, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
  } catch (error) {
    const err = new Error(
      error instanceof Error ? error.message : String(error),
    ) as Error & { status?: number };
    err.status = 0;
    throw err;
  }

  if (!response.ok || !response.body) {
    const error = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    const detail =
      typeof error === "object" && error && "detail" in error
        ? String((error as { detail?: string }).detail)
        : response.statusText;
    const err = new Error(detail || `HTTP ${response.status}`) as Error & {
      status?: number;
    };
    err.status = response.status;
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneEvent: (InstallProgressEvent & { type: "done" }) | null = null;
  let failure: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.rest;
    for (const raw of parsed.events) {
      let event: InstallProgressEvent;
      try {
        event = JSON.parse(raw) as InstallProgressEvent;
      } catch {
        continue;
      }
      onProgress?.(event);
      if (event.type === "done") {
        doneEvent = event;
      } else if (event.type === "error") {
        failure = event.detail;
      }
    }
  }

  if (failure) {
    throw new Error(failure);
  }
  if (!doneEvent) {
    throw new Error("Progress stream ended without a result");
  }
  return doneEvent;
}

function isMissingStreamEndpoint(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  return status === 404 || status === 405 || status === 0;
}

/**
 * Install an agent while streaming stage/download progress over SSE.
 * Falls back to the blocking POST if the stream endpoint is unavailable.
 */
export async function installAgentWithProgress(
  agentId: string,
  onProgress?: (event: InstallProgressEvent) => void,
): Promise<InstalledAgentInfo> {
  const path = `/v2/agents/install/stream?agentId=${encodeURIComponent(agentId)}`;
  try {
    const done = await readInstallProgressStream(path, onProgress);
    if (done.agent) {
      return done.agent;
    }
    throw new Error("Install stream ended without an agent payload");
  } catch (error) {
    if (isMissingStreamEndpoint(error)) {
      return installAgent(agentId);
    }
    throw error;
  }
}

/**
 * Ensure an agent is ready (detect → install if needed → probe).
 * Streams progress over SSE; falls back to blocking POST.
 */
export async function ensureAgentReadyWithProgress(
  agentId: string,
  options?: { preferUpdate?: boolean; forceInstall?: boolean },
  onProgress?: (event: InstallProgressEvent) => void,
): Promise<EnsureReadyResult> {
  const preferUpdate = options?.preferUpdate ?? false;
  const forceInstall = options?.forceInstall ?? false;
  const path =
    `/v2/agents/ensure-ready/stream?agentId=${encodeURIComponent(agentId)}` +
    `&preferUpdate=${preferUpdate ? "true" : "false"}` +
    `&forceInstall=${forceInstall ? "true" : "false"}`;
  try {
    const done = await readInstallProgressStream(path, onProgress);
    if (done.result) {
      return done.result;
    }
    if (done.agent) {
      return {
        agentId: done.agent.agentId,
        readiness: "ready",
        skippedDownload: false,
        source: "managed",
        updateAvailable: false,
        resolvedCommand: done.agent.command,
        installed: done.agent,
      };
    }
    throw new Error("Ensure-ready stream ended without a result");
  } catch (error) {
    if (isMissingStreamEndpoint(error)) {
      return ensureAgentReady(agentId, options);
    }
    throw error;
  }
}

/** True when ensureSession / spawn failed because the agent binary is missing. */
export function isAgentNotReadyError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("not ready") ||
    lower.includes("not found") ||
    lower.includes("not installed") ||
    lower.includes("install from registry") ||
    lower.includes("no valid managed install") ||
    (lower.includes("adapter") && lower.includes("is not installed")) ||
    lower.includes("unknown agent")
  );
}

export async function uninstallAgent(
  agentId: string,
): Promise<InstalledAgentInfo> {
  return fetchJson<InstalledAgentInfo>(
    `/v2/agents/install/${encodeURIComponent(agentId)}`,
    { method: "DELETE" },
  );
}

// --- Task-scoped git session (off / inplace / worktree / snapshot) ---

export type { GitSessionMode } from "./git-session-mode.ts";

export type GitSessionBinding = {
  taskId: string;
  cwd: string;
  repoRoot: string;
  baseBranch: string | null;
  baseSha: string;
  agentBranch: string;
  tipSha: string | null;
  enabled: boolean;
  preRewindSha: string | null;
  /** Isolated agent worktree; set in worktree mode. */
  worktreePath: string | null;
  /** External shadow git dir; set in snapshot mode. */
  shadowGitDir: string | null;
  mode: import("./git-session-mode.ts").GitSessionMode;
};

export type GitChangedFile = {
  status: string;
  path: string;
  additions?: number | null;
  deletions?: number | null;
};

export type GitTurnCommit = {
  taskId: string;
  runId: string;
  commitSha: string;
  parentSha: string;
  message: string;
  createdAt: string;
};

export type GitSessionStatus = {
  binding: GitSessionBinding;
  files: GitChangedFile[];
  aheadOfBase: number;
  dirty: boolean;
};

export type TaskGitResponse = GitSessionStatus & {
  turns: GitTurnCommit[];
};

export async function getTaskGit(taskId: string): Promise<TaskGitResponse> {
  return fetchJson<TaskGitResponse>(`/v2/tasks/${taskId}/git`);
}

export async function getTaskGitDiff(
  taskId: string,
  opts?: { from?: string; to?: string; file?: string },
): Promise<{ diff: string }> {
  const params = new URLSearchParams();
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  if (opts?.file) params.set("file", opts.file);
  const query = params.toString();
  return fetchJson<{ diff: string }>(
    `/v2/tasks/${taskId}/git/diff${query ? `?${query}` : ""}`,
  );
}

export async function rewindTaskGit(
  taskId: string,
  commitSha: string,
): Promise<GitSessionBinding> {
  return fetchJson<GitSessionBinding>(`/v2/tasks/${taskId}/git/rewind`, {
    method: "POST",
    body: JSON.stringify({ commitSha }),
  });
}

export async function unrewindTaskGit(
  taskId: string,
): Promise<GitSessionBinding> {
  return fetchJson<GitSessionBinding>(`/v2/tasks/${taskId}/git/unrewind`, {
    method: "POST",
  });
}

export async function mergeTaskGit(
  taskId: string,
): Promise<{ success: boolean; hash: string }> {
  return fetchJson<{ success: boolean; hash: string }>(
    `/v2/tasks/${taskId}/git/merge`,
    { method: "POST" },
  );
}

export async function undoAllTaskGit(
  taskId: string,
): Promise<GitSessionBinding> {
  return fetchJson<GitSessionBinding>(`/v2/tasks/${taskId}/git/undo-all`, {
    method: "POST",
  });
}

export type RewindTaskResponse = {
  runId: string;
  targetSha: string | null;
  deletedEvents: number;
  deletedTurns: number;
  binding: GitSessionBinding | null;
};

/** Rewind conversation (+ git) to before a user message / run. */
export async function rewindTask(
  taskId: string,
  opts: { runId?: string; userMessageIndex?: number },
): Promise<RewindTaskResponse> {
  return fetchJson<RewindTaskResponse>(`/v2/tasks/${taskId}/rewind`, {
    method: "POST",
    body: JSON.stringify({
      runId: opts.runId,
      userMessageIndex: opts.userMessageIndex,
    }),
  });
}

export function hasSelectableOptions(options: SessionOption[]): boolean {
  return options.length > 1;
}

export function loadingSessionConfig(): SessionConfig {
  return {
    ...EMPTY_SESSION_CONFIG,
    loading: true,
  };
}
