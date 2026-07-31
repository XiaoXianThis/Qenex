import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { assertOpenCodeAvailable, BridgeError } from "./errors.ts";

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

type SessionEntry = {
  info: SessionInfo;
  provider: ACPProvider;
};

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
    const provider = createACPProvider({
      command,
      args: ["acp"],
      session: { cwd, mcpServers: [] },
      persistSession: true,
      env: cleanEnv({
        ACP_AI_PROVIDER_DEBUG: process.env.ACP_AI_PROVIDER_DEBUG,
      }),
    });

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

      this.#sessions.set(sessionId, { info, provider });
      return info;
    } catch (err) {
      try {
        provider.cleanup();
      } catch {
        /* ignore */
      }
      if (err instanceof BridgeError) throw err;
      throw new BridgeError(
        "session_init_failed",
        err instanceof Error ? err.message : String(err),
        502,
        { cause: String(err) },
      );
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
