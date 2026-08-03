import {
  canonicalAgentId,
  commandIsLaunchable,
  discoverLocalAgents,
  evaluateAgentStatus,
  resolveLaunchCommand,
  whichBin,
} from "./detect.ts";
import { ensureAgentReadyOpts } from "./ensure.ts";
import {
  installAgent,
  installAgentWithProgress,
  listInstalled,
  uninstallAgent,
} from "./install.ts";
import { detailError, sseProgressResponse } from "./progress.ts";
import {
  currentPlatformKey,
  loadRegistryDocument,
} from "./registry.ts";
import type { RegistryAgentEntry } from "./types.ts";

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new Error("Request body must be JSON");
  }
}

/**
 * Handle `/v2/agents/*`. Returns null if the path is not an agents route.
 */
export async function handleAgentRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const { pathname } = url;
  if (!pathname.startsWith("/v2/agents")) return null;

  try {
    if (req.method === "POST" && pathname === "/v2/agents/probe") {
      const body = (await readJson(req)) as {
        agentId?: string;
        agentCommand?: string[];
      };
      try {
        const launch = resolveLaunchCommand({
          agentId: body.agentId,
          agentCommand: body.agentCommand,
        });
        const resolved = whichBin(launch.command[0]!) ?? launch.command[0]!;
        return Response.json({
          available: true,
          resolved,
          command: launch.command,
        });
      } catch (err) {
        return Response.json({
          available: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (req.method === "GET" && pathname === "/v2/agents/registry") {
      const refresh = url.searchParams.get("refresh") === "true";
      const doc = await loadRegistryDocument(refresh);
      const platform = currentPlatformKey();
      const agents: RegistryAgentEntry[] = doc.agents.map((raw) => {
        const status = evaluateAgentStatus(raw);
        return {
          id: raw.id,
          name: raw.name,
          version: raw.version,
          description: raw.description,
          repository: raw.repository ?? null,
          website: raw.website ?? null,
          authors: raw.authors ?? [],
          license: raw.license ?? null,
          icon: raw.icon ?? null,
          platform,
          installable: status.installable,
          preferredKind: status.preferredKind ?? null,
          distributionClass: status.distributionClass,
          readiness: status.readiness,
          detected: status.detected,
          resolvedCommand: status.resolvedCommand ?? null,
          detail: status.detail ?? null,
          authHint: status.authHint ?? null,
          installed: status.managed ?? null,
          updateAvailable: status.updateAvailable,
          host: null,
        };
      });
      return Response.json({
        version: doc.version,
        platform,
        agents,
      });
    }

    if (req.method === "GET" && pathname === "/v2/agents/discover") {
      const refresh = url.searchParams.get("refresh") === "true";
      const doc = await loadRegistryDocument(refresh);
      const agents = await discoverLocalAgents(doc.agents);
      return Response.json({ agents });
    }

    if (req.method === "GET" && pathname === "/v2/agents/installed") {
      return Response.json({ agents: listInstalled() });
    }

    if (req.method === "POST" && pathname === "/v2/agents/install") {
      const body = (await readJson(req)) as { agentId?: string };
      if (!body.agentId?.trim()) {
        return detailError(400, "agentId is required");
      }
      const agent = await installAgent(body.agentId.trim());
      return Response.json(agent);
    }

    if (req.method === "GET" && pathname === "/v2/agents/install/stream") {
      const agentId = url.searchParams.get("agentId")?.trim();
      if (!agentId) return detailError(400, "agentId is required");
      return sseProgressResponse(async (emit) => {
        const agent = await installAgentWithProgress(agentId, emit);
        emit({ type: "done", agent });
      });
    }

    const uninstallMatch = pathname.match(
      /^\/v2\/agents\/install\/([^/]+)$/,
    );
    if (uninstallMatch && req.method === "DELETE") {
      const agentId = decodeURIComponent(uninstallMatch[1]!);
      try {
        const removed = uninstallAgent(agentId);
        return Response.json(removed);
      } catch (err) {
        return detailError(
          404,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (req.method === "POST" && pathname === "/v2/agents/ensure-ready") {
      const body = (await readJson(req)) as {
        agentId?: string;
        preferUpdate?: boolean;
        forceInstall?: boolean;
      };
      if (!body.agentId?.trim()) {
        return detailError(400, "agentId is required");
      }
      const result = await ensureAgentReadyOpts(
        body.agentId.trim(),
        body.preferUpdate === true,
        body.forceInstall === true,
      );
      return Response.json(result);
    }

    if (
      req.method === "GET" &&
      pathname === "/v2/agents/ensure-ready/stream"
    ) {
      const agentId = url.searchParams.get("agentId")?.trim();
      if (!agentId) return detailError(400, "agentId is required");
      const preferUpdate = url.searchParams.get("preferUpdate") === "true";
      const forceInstall = url.searchParams.get("forceInstall") === "true";
      return sseProgressResponse(async (emit) => {
        const result = await ensureAgentReadyOpts(
          agentId,
          preferUpdate,
          forceInstall,
          emit,
        );
        emit({ type: "done", result });
      });
    }

    if (
      req.method === "GET" &&
      pathname === "/v2/agents/host/install/stream"
    ) {
      return sseProgressResponse(async (emit) => {
        emit({
          type: "error",
          detail:
            "Host CLI install is not yet available in the Bun bridge; install the host CLI manually, then Ensure Ready.",
        });
      });
    }

    return detailError(404, `Unknown agents route: ${pathname}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return detailError(502, message);
  }
}

// re-export helpers used by session-store
export { canonicalAgentId, commandIsLaunchable, resolveLaunchCommand };
