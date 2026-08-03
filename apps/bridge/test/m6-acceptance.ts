/**
 * Live M6 acceptance: agents API + multi-agent session create/chat.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridgeServer } from "../src/server.ts";

const workspace = mkdtempSync(join(tmpdir(), "qenex-m6-ws-"));
const dbPath = join(mkdtempSync(join(tmpdir(), "qenex-m6-db-")), "sessions.db");

async function readJson(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

try {
  const server = startBridgeServer({
    hostname: "127.0.0.1",
    port: 0,
    dbPath,
  });
  console.log("[m6] server", server.url);

  // Registry
  const reg = await fetch(`${server.url}/v2/agents/registry`);
  const regBody = await readJson(reg);
  if (!reg.ok || !Array.isArray(regBody.agents) || (regBody.agents as unknown[]).length < 1) {
    throw new Error(`registry failed: ${JSON.stringify(regBody).slice(0, 400)}`);
  }
  console.log("[m6] registry", (regBody.agents as unknown[]).length, "platform", regBody.platform);

  // Discover
  const disc = await fetch(`${server.url}/v2/agents/discover`);
  const discBody = await readJson(disc);
  const discovered = (discBody.agents as Array<{ id: string; readiness: string }>) ?? [];
  if (!disc.ok || discovered.length < 1) {
    throw new Error(`discover failed: ${JSON.stringify(discBody).slice(0, 400)}`);
  }
  console.log(
    "[m6] discover",
    discovered.map((a) => a.id).slice(0, 12),
  );

  // Installed + ensure-ready for opencode
  const ensureOc = await fetch(`${server.url}/v2/agents/ensure-ready`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "opencode" }),
  });
  const ensureOcBody = await readJson(ensureOc);
  if (!ensureOc.ok) {
    throw new Error(`ensure opencode failed: ${JSON.stringify(ensureOcBody)}`);
  }
  console.log("[m6] ensure opencode", ensureOcBody.readiness, ensureOcBody.skippedDownload);

  // Second agent: prefer claude-acp if discovered, else first non-opencode ready
  const second =
    discovered.find((a) => a.id === "claude-acp") ??
    discovered.find((a) => a.id !== "opencode" && (a.readiness === "ready" || a.readiness === "needAuth"));
  if (!second) {
    throw new Error("need a second discovered agent besides opencode");
  }
  const ensure2 = await fetch(`${server.url}/v2/agents/ensure-ready`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: second.id }),
  });
  const ensure2Body = await readJson(ensure2);
  if (!ensure2.ok) {
    throw new Error(`ensure ${second.id} failed: ${JSON.stringify(ensure2Body)}`);
  }
  console.log("[m6] ensure", second.id, ensure2Body.readiness);

  // Probe
  const probe = await fetch(`${server.url}/v2/agents/probe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: second.id }),
  });
  const probeBody = await readJson(probe);
  if (!probe.ok || probeBody.available !== true) {
    throw new Error(`probe ${second.id} failed: ${JSON.stringify(probeBody)}`);
  }
  console.log("[m6] probe", second.id, "ok");

  // Create sessions for both agents
  async function createAndPing(agentId: string) {
    const create = await fetch(`${server.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: workspace, agentId }),
    });
    const created = await readJson(create);
    if (!create.ok || typeof created.sessionId !== "string") {
      throw new Error(`create ${agentId} failed: ${JSON.stringify(created).slice(0, 500)}`);
    }
    if (created.agent !== agentId) {
      throw new Error(`create ${agentId} agent mismatch: ${created.agent}`);
    }
    console.log("[m6] session", agentId, created.sessionId);

    const chat = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: created.sessionId,
        messages: [
          {
            id: `u_${agentId}`,
            role: "user",
            parts: [{ type: "text", text: "Reply with exactly: ok" }],
          },
        ],
        approvalMode: "auto",
      }),
    });
    if (!chat.ok) {
      const errText = await chat.text();
      throw new Error(`chat ${agentId} failed ${chat.status}: ${errText.slice(0, 400)}`);
    }
    // Drain a bit of the stream
    const reader = chat.body?.getReader();
    if (reader) {
      const t0 = Date.now();
      while (Date.now() - t0 < 25_000) {
        const { done } = await reader.read();
        if (done) break;
      }
      try {
        reader.cancel();
      } catch {
        /* ignore */
      }
    }
    console.log("[m6] chat stream", agentId, "ok");
    await fetch(`${server.url}/api/sessions/${encodeURIComponent(String(created.sessionId))}`, {
      method: "DELETE",
    });
  }

  await createAndPing("opencode");
  await createAndPing(second.id);

  server.stop({ wipe: true });
  console.log("M6_ACCEPTANCE_OK");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
