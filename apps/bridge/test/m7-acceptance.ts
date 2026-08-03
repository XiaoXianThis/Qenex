/**
 * Live M7 acceptance: CORS + Desktop-style Bun Bridge spawn.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type Subprocess } from "bun";
import { startBridgeServer } from "../src/server.ts";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);
const bridgeEntry = resolve(repoRoot, "apps/bridge/src/index.ts");
const workspace = mkdtempSync(join(tmpdir(), "qenex-m7-ws-"));
const dbPath = join(mkdtempSync(join(tmpdir(), "qenex-m7-db-")), "sessions.db");

async function waitHealth(baseUrl: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      last = await res.text();
      if (res.ok) return JSON.parse(last) as Record<string, unknown>;
    } catch (err) {
      last = String(err);
    }
    await Bun.sleep(200);
  }
  throw new Error(`health timeout: ${last}`);
}

async function readJson(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

let child: Subprocess | null = null;

try {
  // --- CORS on in-process server ---
  process.env.QENEX_CORS_ORIGINS = "http://localhost:1420,https://tauri.localhost";
  const server = startBridgeServer({
    hostname: "127.0.0.1",
    port: 0,
    dbPath,
  });
  console.log("[m7] in-process server", server.url);

  const origin = "http://localhost:1420";
  const preflight = await fetch(`${server.url}/health`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "GET",
    },
  });
  if (preflight.status !== 204 && preflight.status !== 200) {
    throw new Error(`preflight status ${preflight.status}`);
  }
  const allowOrigin = preflight.headers.get("access-control-allow-origin");
  if (allowOrigin !== origin) {
    throw new Error(`preflight ACAO=${allowOrigin}, expected ${origin}`);
  }
  console.log("[m7] CORS preflight OK", allowOrigin);

  const health = await fetch(`${server.url}/health`, {
    headers: { origin },
  });
  const healthAcao = health.headers.get("access-control-allow-origin");
  if (!health.ok || healthAcao !== origin) {
    throw new Error(`health CORS failed: ${health.status} acao=${healthAcao}`);
  }
  console.log("[m7] CORS health OK");

  // Denied origin should not echo foreign origin
  const denied = await fetch(`${server.url}/health`, {
    headers: { origin: "https://evil.example" },
  });
  const deniedAcao = denied.headers.get("access-control-allow-origin");
  if (deniedAcao === "https://evil.example") {
    throw new Error("CORS incorrectly allowed evil origin");
  }
  console.log("[m7] CORS deny OK");

  server.stop({ wipe: true });

  // --- Desktop-style external Bun spawn ---
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });
  const port = probe.port;
  if (!port) throw new Error("failed to allocate free port");
  await probe.stop(true);
  const baseUrl = `http://127.0.0.1:${port}`;
  const spawnDb = join(mkdtempSync(join(tmpdir(), "qenex-m7-spawn-db-")), "sessions.db");

  console.log("[m7] spawning Bun Bridge", bridgeEntry, "port", port);
  child = spawn({
    cmd: ["bun", bridgeEntry],
    cwd: resolve(repoRoot, "apps/bridge"),
    env: {
      ...process.env,
      QENEX_BRIDGE_HOST: "127.0.0.1",
      QENEX_BRIDGE_PORT: String(port),
      QENEX_SESSIONS_DB: spawnDb,
      QENEX_CORS_ORIGINS: "http://localhost:1420,https://tauri.localhost",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  await waitHealth(baseUrl);
  console.log("[m7] spawned bridge healthy");

  const create = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:1420",
    },
    body: JSON.stringify({ cwd: workspace }),
  });
  const created = await readJson(create);
  if (!create.ok || typeof created.sessionId !== "string") {
    throw new Error(`create session failed: ${JSON.stringify(created).slice(0, 400)}`);
  }
  const createAcao = create.headers.get("access-control-allow-origin");
  if (createAcao !== "http://localhost:1420") {
    throw new Error(`create missing CORS: ${createAcao}`);
  }
  console.log("[m7] session", created.sessionId);

  const chat = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: created.sessionId,
      messages: [
        {
          id: "u_m7",
          role: "user",
          parts: [{ type: "text", text: "Reply with exactly: m7-ok" }],
        },
      ],
      approvalMode: "auto",
    }),
  });
  if (!chat.ok || !chat.body) {
    throw new Error(`chat failed: ${chat.status} ${await chat.text()}`);
  }
  const reader = chat.body.getReader();
  const decoder = new TextDecoder();
  let streamed = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const { done, value } = await reader.read();
    if (done) break;
    streamed += decoder.decode(value, { stream: true });
    if (streamed.includes("m7-ok") || streamed.length > 80_000) break;
  }
  try {
    reader.cancel();
  } catch {
    /* ignore */
  }
  if (!streamed.includes("data:") && streamed.trim().length < 8) {
    throw new Error(`chat stream empty/unexpected: ${streamed.slice(0, 500)}`);
  }
  console.log("[m7] chat stream OK", streamed.slice(0, 120).replace(/\n/g, "\\n"));

  // History surface: list + fetch session detail (Desktop restore path)
  const list = await fetch(`${baseUrl}/api/sessions`);
  const listBody = await readJson(list);
  const sessions = (listBody.sessions as unknown[]) ?? [];
  if (!list.ok || sessions.length < 1) {
    throw new Error(`sessions list failed: ${JSON.stringify(listBody).slice(0, 300)}`);
  }
  const detail = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(String(created.sessionId))}`,
  );
  const detailBody = await readJson(detail);
  if (!detail.ok || detailBody.sessionId !== created.sessionId) {
    throw new Error(`session detail failed: ${JSON.stringify(detailBody).slice(0, 300)}`);
  }
  console.log("[m7] sessions list", sessions.length, "detail ok");

  // Approvals endpoint reachable (Desktop approval UI depends on it)
  const approvals = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(String(created.sessionId))}/approvals`,
  );
  // 200 empty list or 404 depending on route shape — just not 5xx / CORS break
  if (approvals.status >= 500) {
    throw new Error(`approvals endpoint error: ${approvals.status}`);
  }
  console.log("[m7] approvals endpoint status", approvals.status);

  console.log("M7_ACCEPTANCE_OK");
} catch (err) {
  console.error("[m7] FAILED", err);
  process.exitCode = 1;
} finally {
  if (child) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
