import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { assertOpenCodeAvailable, BridgeError } from "./errors.ts";
import {
  ApprovalManager,
  type PermissionRequestParams,
  type PermissionResponse,
} from "./approval-manager.ts";
import { buildOpenCodeConfigContent } from "./opencode-config.ts";
import { classifySessionInitError } from "./session-errors.ts";

export type SessionInfo = {
  sessionId: string;
  agent: "opencode";
  cwd: string;
  createdAt: string;
  modes?: {
    currentModeId?: string;
    availableModes?: Array<{ id: string; name?: string }>;
  };
  models?: {
    currentModelId?: string;
    availableModels?: Array<{ modelId: string; name?: string }>;
  };
};

export type SessionEntry = {
  info: SessionInfo;
  provider: ACPProvider;
  approvals: ApprovalManager;
};

type PermissionAwareModel = {
  client?: {
    setPermissionRequestHandler?: (
      handler: (params: PermissionRequestParams) => Promise<PermissionResponse>,
    ) => void;
    readTextFile?: (params: {
      sessionId: string;
      path: string;
      line?: number | null;
      limit?: number | null;
    }) => Promise<{ content: string }> | { content: string };
    writeTextFile?: (params: {
      sessionId: string;
      path: string;
      content: string;
    }) => Promise<Record<string, never>> | Record<string, never>;
    sessionUpdate?: (params: {
      update?: {
        sessionUpdate?: string;
        status?: string | null;
        rawOutput?: unknown;
        content?: unknown;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }) => Promise<void>;
  };
};

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function installClientHandlers(
  provider: ACPProvider,
  approvals: ApprovalManager,
  cwd: string,
  sessionId: string,
): void {
  const model = provider.languageModel() as unknown as PermissionAwareModel;
  if (!model.client?.setPermissionRequestHandler) {
    throw new BridgeError(
      "permission_bridge_unavailable",
      "The installed ACP provider does not expose the permission callback required by Qenex. Check the pinned @mcpc-tech/acp-ai-provider version.",
      500,
    );
  }
  model.client.setPermissionRequestHandler((params) =>
    approvals.handlePermissionRequest(params),
  );

  const originalSessionUpdate = model.client.sessionUpdate?.bind(model.client);
  if (originalSessionUpdate) {
    model.client.sessionUpdate = (params) => {
      const update = params.update;
      // Provider 0.3.4's failed-tool formatter assumes rawOutput is iterable.
      // OpenCode can send `{}` there after a rejection; prefer ACP content.
      if (
        update?.sessionUpdate === "tool_call_update" &&
        update.status === "failed" &&
        !Array.isArray(update.rawOutput)
      ) {
        return originalSessionUpdate({
          ...params,
          update: {
            ...update,
            rawOutput: Array.isArray(update.content) ? update.content : [],
          },
        });
      }
      return originalSessionUpdate(params);
    };
  }

  // Provider 0.3.4 advertises fs support as false but OpenCode 1.18 can still
  // issue fs/* requests after an approved edit. Implement the ACP methods and
  // confine them to the real session workspace (including symlink checks).
  const realCwd = realpathSync(cwd);
  const assertSession = (received: string) => {
    if (received !== sessionId) {
      throw new Error(`ACP filesystem request has wrong sessionId: ${received}`);
    }
  };
  model.client.readTextFile = (params) => {
    assertSession(params.sessionId);
    const target = realpathSync(resolve(cwd, params.path));
    if (!isWithin(realCwd, target)) {
      throw new Error(`ACP read is outside the session workspace: ${params.path}`);
    }
    const content = readFileSync(target, "utf8");
    if (params.line == null && params.limit == null) return { content };
    const start = Math.max(0, (params.line ?? 1) - 1);
    const end = params.limit == null ? undefined : start + Math.max(0, params.limit);
    return { content: content.split("\n").slice(start, end).join("\n") };
  };
  model.client.writeTextFile = (params) => {
    assertSession(params.sessionId);
    const target = resolve(cwd, params.path);
    if (existsSync(target)) {
      const realTarget = realpathSync(target);
      if (!isWithin(realCwd, realTarget)) {
        throw new Error(`ACP write is outside the session workspace: ${params.path}`);
      }
    }
    const realParent = realpathSync(dirname(target));
    if (!isWithin(realCwd, realParent)) {
      throw new Error(`ACP write is outside the session workspace: ${params.path}`);
    }
    writeFileSync(target, params.content, "utf8");
    return {};
  };
}

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

export class SessionStore {
  #sessions = new Map<string, SessionEntry>();

  get size(): number {
    return this.#sessions.size;
  }

  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  get(sessionId: string): SessionEntry {
    const entry = this.#sessions.get(sessionId);
    if (!entry) {
      throw new BridgeError(
        "session_not_found",
        `Session not found: ${sessionId}`,
        404,
      );
    }
    return entry;
  }

  list(): SessionInfo[] {
    return [...this.#sessions.values()].map((e) => e.info);
  }

  async create(input: { cwd: string }): Promise<SessionInfo> {
    const cwd = resolve(input.cwd);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new BridgeError(
        "invalid_cwd",
        `cwd must be an existing directory: ${cwd}`,
        400,
      );
    }

    const command = assertOpenCodeAvailable();
    let inlineConfig: string;
    try {
      inlineConfig = buildOpenCodeConfigContent(
        process.env.OPENCODE_CONFIG_CONTENT,
      );
    } catch (err) {
      throw new BridgeError(
        "invalid_opencode_config",
        err instanceof Error ? err.message : String(err),
        500,
      );
    }
    const provider = createACPProvider({
      command,
      args: ["acp"],
      session: { cwd, mcpServers: [] },
      persistSession: true,
      env: cleanEnv({
        ACP_AI_PROVIDER_DEBUG: process.env.ACP_AI_PROVIDER_DEBUG,
        OPENCODE_CONFIG_CONTENT: inlineConfig,
      }),
    });
    const approvals = new ApprovalManager();

    try {
      const session = await provider.initSession();
      const sessionId = session.sessionId;
      if (!sessionId) {
        throw new BridgeError(
          "session_init_failed",
          "OpenCode ACP initSession did not return a sessionId",
          502,
        );
      }
      installClientHandlers(provider, approvals, cwd, sessionId);

      const info: SessionInfo = {
        sessionId,
        agent: "opencode",
        cwd,
        createdAt: new Date().toISOString(),
        modes: session.modes
          ? {
              currentModeId: session.modes.currentModeId,
              availableModes: session.modes.availableModes?.map((m) => ({
                id: m.id,
                name: (m as { name?: string }).name,
              })),
            }
          : undefined,
        models: session.models
          ? {
              currentModelId:
                (session.models as { currentModelId?: string }).currentModelId,
              availableModels: session.models.availableModels?.map((m) => ({
                modelId: m.modelId,
                name: (m as { name?: string }).name,
              })),
            }
          : undefined,
      };

      this.#sessions.set(sessionId, { info, provider, approvals });
      return info;
    } catch (err) {
      try {
        provider.cleanup();
      } catch {
        /* ignore */
      }
      throw classifySessionInitError(err);
    }
  }

  delete(sessionId: string): void {
    const entry = this.#sessions.get(sessionId);
    if (!entry) {
      throw new BridgeError(
        "session_not_found",
        `Session not found: ${sessionId}`,
        404,
      );
    }
    this.#sessions.delete(sessionId);
    entry.approvals.cancelAll();
    try {
      entry.provider.cleanup();
    } catch {
      /* ignore cleanup errors */
    }
  }

  /** Tear down every session (tests / shutdown). */
  clear(): void {
    for (const id of [...this.#sessions.keys()]) {
      try {
        this.delete(id);
      } catch {
        this.#sessions.delete(id);
      }
    }
  }
}

export const sessions = new SessionStore();
