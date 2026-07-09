import {
  EMPTY_SESSION_CONFIG,
  parseSessionOptions,
  type SessionConfig,
  type SessionOption,
} from "./session-config.ts";

export type ApprovalResponse = {
  success: boolean;
  callId: string;
};

export type EnsureSessionRequest = {
  taskId: string;
  cwd: string;
  agentCommand: string[];
  title?: string;
  mode?: string;
  model?: string;
  resumeSessionId?: string;
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
};

export type TaskListResponse = {
  tasks: TaskSummary[];
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
      agentCommand: request.agentCommand,
      mode: request.mode,
      model: request.model,
      resumeSessionId: request.resumeSessionId,
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

export async function listTasks(): Promise<TaskListResponse> {
  return fetchJson<TaskListResponse>("/v2/tasks");
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
  detail?: string;
};

export async function probeAgent(
  agentCommand: string[],
): Promise<ProbeAgentResponse> {
  return fetchJson<ProbeAgentResponse>("/v2/agents/probe", {
    method: "POST",
    body: JSON.stringify({ agentCommand }),
  });
}

export type AgentInstallKind = "binary" | "npx" | "uvx";

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
  installed?: InstalledAgentInfo | null;
  updateAvailable: boolean;
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
      agent: InstalledAgentInfo;
    }
  | {
      type: "error";
      detail: string;
    };

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

/**
 * Install an agent while streaming stage/download progress over SSE.
 * Falls back to the blocking POST if the stream endpoint is unavailable.
 */
export async function installAgentWithProgress(
  agentId: string,
  onProgress?: (event: InstallProgressEvent) => void,
): Promise<InstalledAgentInfo> {
  const path = `/v2/agents/install/stream?agentId=${encodeURIComponent(agentId)}`;
  let response: Response;
  try {
    response = await bridgeFetch(path, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
  } catch {
    return installAgent(agentId);
  }

  if (!response.ok || !response.body) {
    // Older bridge without stream route.
    if (response.status === 404 || response.status === 405) {
      return installAgent(agentId);
    }
    const error = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    const detail =
      typeof error === "object" && error && "detail" in error
        ? String((error as { detail?: string }).detail)
        : response.statusText;
    throw new Error(detail || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let installed: InstalledAgentInfo | null = null;
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
        installed = event.agent;
      } else if (event.type === "error") {
        failure = event.detail;
      }
    }
  }

  if (failure) {
    throw new Error(failure);
  }
  if (!installed) {
    throw new Error("Install stream ended without a result");
  }
  return installed;
}

export async function uninstallAgent(
  agentId: string,
): Promise<InstalledAgentInfo> {
  return fetchJson<InstalledAgentInfo>(
    `/v2/agents/install/${encodeURIComponent(agentId)}`,
    { method: "DELETE" },
  );
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
