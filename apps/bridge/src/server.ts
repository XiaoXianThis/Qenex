import { jsonError, BridgeError, resolveOpenCodeBin } from "./errors.ts";
import { handleChat, type ChatRequestBody } from "./chat.ts";
import { SessionStore } from "./session-store.ts";

export type BridgeServerOptions = {
  /** Defaults to 127.0.0.1 — Phase 1 requires localhost-only. */
  hostname?: string;
  port?: number;
  store?: SessionStore;
  /** When true, do not keep process alive (tests). */
  idleTimeout?: number;
};

export type BridgeServer = {
  store: SessionStore;
  hostname: string;
  port: number;
  url: string;
  fetch: (req: Request) => Promise<Response> | Response;
  stop: () => void;
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
    const url = new URL(req.url);
    const { pathname } = url;

    try {
      if (req.method === "GET" && pathname === "/health") {
        return Response.json({
          ok: true,
          agent: "opencode",
          opencode: resolveOpenCodeBin(),
          sessions: store.size,
          listen: "127.0.0.1",
        });
      }

      if (req.method === "GET" && pathname === "/api/sessions") {
        return Response.json({ sessions: store.list() });
      }

      if (req.method === "POST" && pathname === "/api/sessions") {
        const body = (await readJson(req)) as { cwd?: string };
        if (!body.cwd || typeof body.cwd !== "string") {
          throw new BridgeError(
            "missing_cwd",
            "Request body must include cwd: string",
            400,
          );
        }
        const info = await store.create({ cwd: body.cwd });
        return Response.json(info, { status: 201 });
      }

      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1]!);
        if (req.method === "GET") {
          const entry = store.get(sessionId);
          return Response.json(entry.info);
        }
        if (req.method === "DELETE") {
          store.delete(sessionId);
          return Response.json({ ok: true, sessionId });
        }
      }

      if (req.method === "POST" && pathname === "/api/chat") {
        const body = (await readJson(req)) as ChatRequestBody;
        return await handleChat(store, body, req);
      }

      return notFound();
    } catch (err) {
      return jsonError(err);
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
      `Phase 1 bridge must bind to 127.0.0.1 (got ${hostname})`,
      500,
    );
  }

  const store = options.store ?? new SessionStore();
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
    stop: () => {
      store.clear();
      server.stop(true);
    },
  };
}
