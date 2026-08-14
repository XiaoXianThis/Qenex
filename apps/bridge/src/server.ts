import { jsonError, BridgeError, resolveOpenCodeBin } from "./errors.ts";
import { handleChat, type ChatRequestBody } from "./chat.ts";
import { listWorkspaceFiles } from "./files.ts";
import { SessionStore } from "./session-store.ts";
import { handleAgentRoutes } from "./agent/routes.ts";
import { listInstalled } from "./agent/installed-db.ts";
import { corsPreflightResponse, withCors } from "./cors.ts";

export type BridgeServerOptions = {
  /** Defaults to 127.0.0.1 — Bridge must bind to localhost. */
  hostname?: string;
  port?: number;
  store?: SessionStore;
  /** SQLite path when constructing the default store. */
  dbPath?: string;
  /** When true, do not keep process alive (tests). */
  idleTimeout?: number;
};

export type BridgeServer = {
  store: SessionStore;
  hostname: string;
  port: number;
  url: string;
  fetch: (req: Request) => Promise<Response> | Response;
  stop: (options?: { wipe?: boolean }) => void;
};

function notFound(): Response {
  return Response.json(
    { error: { code: "not_found", message: "Not found" } },
    { status: 404 },
  );
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BridgeError("invalid_json", "Request body must be JSON", 400);
  }
}

export function createBridgeHandler(store: SessionStore) {
  return async function handleRequest(req: Request): Promise<Response> {
    const preflight = corsPreflightResponse(req);
    if (preflight) return preflight;

    const url = new URL(req.url);
    const { pathname } = url;

    try {
      let response: Response;

      if (req.method === "GET" && pathname === "/health") {
        response = Response.json({
          ok: true,
          agent: "multi",
          opencode: resolveOpenCodeBin(),
          installedAgents: listInstalled().length,
          sessions: store.size,
          persistedSessions: store.persistedCount,
          sessionsDb: store.dbPath,
          listen: "127.0.0.1",
        });
        return withCors(req, response);
      }

      const agentResponse = await handleAgentRoutes(req, url);
      if (agentResponse) return withCors(req, agentResponse);

      if (req.method === "GET" && pathname === "/api/files") {
        const base = url.searchParams.get("base") ?? ".";
        const path = url.searchParams.get("path") ?? ".";
        const result = listWorkspaceFiles({ base, path });
        return withCors(req, Response.json(result));
      }

      if (req.method === "GET" && pathname === "/api/sessions") {
        return withCors(req, Response.json({ sessions: store.list() }));
      }

      if (req.method === "POST" && pathname === "/api/sessions") {
        const body = (await readJson(req)) as {
          cwd?: string;
          agentId?: string;
          agentCommand?: string[];
        };
        if (!body.cwd || typeof body.cwd !== "string") {
          throw new BridgeError(
            "missing_cwd",
            "Request body must include cwd: string",
            400,
          );
        }
        const info = await store.create({
          cwd: body.cwd,
          agentId: typeof body.agentId === "string" ? body.agentId : undefined,
          agentCommand: Array.isArray(body.agentCommand)
            ? body.agentCommand.filter((p): p is string => typeof p === "string")
            : undefined,
          signal: req.signal,
        });
        return withCors(req, Response.json(info, { status: 201 }));
      }

      const messagesMatch = pathname.match(
        /^\/api\/sessions\/([^/]+)\/messages$/,
      );
      if (messagesMatch && req.method === "GET") {
        const sessionId = decodeURIComponent(messagesMatch[1]!);
        const messages = store.getMessages(sessionId);
        return withCors(
          req,
          Response.json({ sessionId, messages }),
        );
      }

      const configMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/config$/);
      if (configMatch && req.method === "GET") {
        const sessionId = decodeURIComponent(configMatch[1]!);
        return withCors(req, Response.json(await store.getConfig(sessionId)));
      }

      const modelConfigMatch = pathname.match(
        /^\/api\/sessions\/([^/]+)\/models\/([^/]+)\/config$/,
      );
      if (modelConfigMatch && req.method === "GET") {
        const sessionId = decodeURIComponent(modelConfigMatch[1]!);
        const modelId = decodeURIComponent(modelConfigMatch[2]!);
        return withCors(
          req,
          Response.json(await store.getModelConfig(sessionId, modelId)),
        );
      }

      const modeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/mode$/);
      if (modeMatch && req.method === "POST") {
        const sessionId = decodeURIComponent(modeMatch[1]!);
        const body = (await readJson(req)) as { modeId?: unknown };
        if (typeof body.modeId !== "string" || !body.modeId.trim()) {
          throw new BridgeError(
            "missing_mode_id",
            "Request body must include modeId: string",
            400,
          );
        }
        const config = await store.setMode(sessionId, body.modeId);
        return withCors(req, Response.json(config));
      }

      const modelMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/model$/);
      if (modelMatch && req.method === "POST") {
        const sessionId = decodeURIComponent(modelMatch[1]!);
        const body = (await readJson(req)) as { modelId?: unknown };
        if (typeof body.modelId !== "string" || !body.modelId.trim()) {
          throw new BridgeError(
            "missing_model_id",
            "Request body must include modelId: string",
            400,
          );
        }
        const config = await store.setModel(sessionId, body.modelId);
        return withCors(req, Response.json(config));
      }

      const configOptionMatch = pathname.match(
        /^\/api\/sessions\/([^/]+)\/config-option$/,
      );
      if (configOptionMatch && req.method === "POST") {
        const sessionId = decodeURIComponent(configOptionMatch[1]!);
        const body = (await readJson(req)) as {
          configId?: unknown;
          value?: unknown;
        };
        if (
          typeof body.configId !== "string" ||
          !body.configId.trim() ||
          typeof body.value !== "string" ||
          !body.value.trim()
        ) {
          throw new BridgeError(
            "invalid_config_option",
            "Request body must include non-empty configId and value strings",
            400,
          );
        }
        const config = await store.setConfigOption(
          sessionId,
          body.configId,
          body.value,
        );
        return withCors(req, Response.json(config));
      }

      const probeModelMatch = pathname.match(
        /^\/api\/sessions\/([^/]+)\/probe-model-config$/,
      );
      if (probeModelMatch && req.method === "POST") {
        const sessionId = decodeURIComponent(probeModelMatch[1]!);
        const body = (await readJson(req)) as { modelId?: unknown };
        if (typeof body.modelId !== "string" || !body.modelId.trim()) {
          throw new BridgeError(
            "invalid_model",
            "Request body must include modelId: string",
            400,
          );
        }
        const probe = await store.probeModelConfig(sessionId, body.modelId);
        return withCors(req, Response.json(probe));
      }

      const probeModelsMatch = pathname.match(
        /^\/api\/sessions\/([^/]+)\/probe-models-config$/,
      );
      if (probeModelsMatch && req.method === "POST") {
        const sessionId = decodeURIComponent(probeModelsMatch[1]!);
        const body = (await readJson(req)) as { modelIds?: unknown };
        const modelIds = Array.isArray(body.modelIds)
          ? body.modelIds.filter(
              (modelId): modelId is string =>
                typeof modelId === "string" && modelId.trim().length > 0,
            )
          : [];
        if (modelIds.length === 0) {
          throw new BridgeError(
            "invalid_models",
            "Request body must include at least one modelId",
            400,
          );
        }
        const probes = await store.probeModelsConfig(sessionId, modelIds);
        return withCors(req, Response.json({ probes }));
      }

      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1]!);
        if (req.method === "GET") {
          const info = store.getInfo(sessionId);
          return withCors(req, Response.json(info));
        }
        if (req.method === "PATCH") {
          const body = (await readJson(req)) as { title?: unknown };
          if (typeof body.title !== "string") {
            throw new BridgeError(
              "invalid_title",
              "Request body must include title: string",
              400,
            );
          }
          const info = store.updateTitle(sessionId, body.title);
          return withCors(req, Response.json(info));
        }
        if (req.method === "DELETE") {
          store.delete(sessionId);
          return withCors(req, Response.json({ ok: true, sessionId }));
        }
      }

      const approvalsMatch = pathname.match(
        /^\/api\/sessions\/([^/]+)\/approvals$/,
      );
      if (approvalsMatch && req.method === "GET") {
        const sessionId = decodeURIComponent(approvalsMatch[1]!);
        const entry = await store.ensureOpen(sessionId);
        return withCors(
          req,
          Response.json({
            mode: entry.approvals.mode,
            approvals: entry.approvals.list(),
          }),
        );
      }

      const approvalMatch = pathname.match(
        /^\/api\/sessions\/([^/]+)\/approvals\/([^/]+)$/,
      );
      if (approvalMatch && req.method === "POST") {
        const sessionId = decodeURIComponent(approvalMatch[1]!);
        const approvalId = decodeURIComponent(approvalMatch[2]!);
        const body = (await readJson(req)) as { optionId?: unknown };
        if (typeof body.optionId !== "string" || !body.optionId) {
          throw new BridgeError(
            "missing_approval_option",
            "Request body must include optionId: string",
            400,
          );
        }
        const entry = await store.ensureOpen(sessionId);
        const approval = entry.approvals.decide(approvalId, body.optionId);
        return withCors(
          req,
          Response.json({
            ok: true,
            approvalId,
            optionId: body.optionId,
            approval,
          }),
        );
      }

      if (req.method === "POST" && pathname === "/api/chat") {
        const body = (await readJson(req)) as ChatRequestBody;
        return withCors(req, await handleChat(store, body, req));
      }

      return withCors(req, notFound());
    } catch (err) {
      return withCors(req, jsonError(err));
    }
  };
}

export function startBridgeServer(
  options: BridgeServerOptions = {},
): BridgeServer {
  const hostname = options.hostname ?? "127.0.0.1";
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new BridgeError(
      "invalid_bind",
      `Bridge must bind to 127.0.0.1 (got ${hostname})`,
      500,
    );
  }

  const store =
    options.store ??
    new SessionStore(options.dbPath ? { dbPath: options.dbPath } : {});
  const fetchHandler = createBridgeHandler(store);

  const server = Bun.serve({
    hostname,
    port: options.port ?? 0,
    idleTimeout: options.idleTimeout ?? 255,
    fetch: fetchHandler,
  });

  const port = server.port;
  if (port == null) {
    throw new BridgeError("listen_failed", "Failed to bind bridge port", 500);
  }

  return {
    store,
    hostname: server.hostname ?? hostname,
    port,
    url: `http://127.0.0.1:${port}`,
    fetch: (req) => fetchHandler(req),
    stop: (stopOptions) => {
      if (stopOptions?.wipe) {
        store.clear();
      } else {
        store.dispose();
      }
      try {
        store.closeDb();
      } catch {
        /* ignore */
      }
      server.stop(true);
    },
  };
}
