/**
 * Live M9 acceptance: IDE Bun Bridge spawn contract (JetBrains + VS Code).
 * Chat surface uses the hermetic fake ACP so CI does not need OpenCode.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type Subprocess } from "bun";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);
const bridgeEntry = resolve(repoRoot, "apps/bridge/src/index.ts");
const fakeAcp = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/fake-acp.ts",
);
const workspace = mkdtempSync(join(tmpdir(), "qenex-m9-ws-"));

function fakeCommand(): string[] {
  return [process.execPath, fakeAcp];
}

async function waitHealth(baseUrl: string, timeoutMs = 25_000) {
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

async function allocatePort(): Promise<number> {
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
  return port;
}

async function spawnBridge(opts: {
  label: string;
  port: number;
  cors: string;
  dbPath: string;
}): Promise<Subprocess> {
  console.log(`[m9] ${opts.label}: spawn bun entry port=${opts.port}`);
  console.log(`[m9] ${opts.label}: CORS=${opts.cors}`);
  return spawn({
    cmd: ["bun", bridgeEntry],
    cwd: resolve(repoRoot, "apps/bridge"),
    env: {
      ...process.env,
      QENEX_BRIDGE_HOST: "127.0.0.1",
      QENEX_BRIDGE_PORT: String(opts.port),
      QENEX_SESSIONS_DB: opts.dbPath,
      QENEX_CORS_ORIGINS: opts.cors,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function assertCors(
  baseUrl: string,
  origin: string,
  label: string,
): Promise<void> {
  const preflight = await fetch(`${baseUrl}/health`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "GET",
    },
  });
  if (preflight.status !== 204 && preflight.status !== 200) {
    throw new Error(`${label} preflight status ${preflight.status}`);
  }
  const allowOrigin = preflight.headers.get("access-control-allow-origin");
  if (allowOrigin !== origin) {
    throw new Error(`${label} preflight ACAO=${allowOrigin}, expected ${origin}`);
  }
  console.log(`[m9] ${label} CORS OK`, allowOrigin);
}

async function assertChatSurface(
  baseUrl: string,
  origin: string,
  label: string,
): Promise<void> {
  const create = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      cwd: workspace,
      agentId: "fake-acp",
      agentCommand: fakeCommand(),
    }),
  });
  const created = await readJson(create);
  if (!create.ok || typeof created.sessionId !== "string") {
    throw new Error(
      `${label} create session failed: ${JSON.stringify(created).slice(0, 400)}`,
    );
  }
  console.log(`[m9] ${label} session`, created.sessionId);

  const chat = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      sessionId: created.sessionId,
      messages: [
        {
          id: `u_m9_${label}`,
          role: "user",
          parts: [{ type: "text", text: "Reply with exactly: m9-ok" }],
        },
      ],
      approvalMode: "auto",
    }),
  });
  if (!chat.ok || !chat.body) {
    throw new Error(`${label} chat failed: ${chat.status} ${await chat.text()}`);
  }
  const reader = chat.body.getReader();
  const decoder = new TextDecoder();
  let streamed = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    const { done, value } = await reader.read();
    if (done) break;
    streamed += decoder.decode(value, { stream: true });
    if (streamed.includes("m9-ok") || streamed.length > 80_000) break;
  }
  try {
    reader.cancel();
  } catch {
    /* ignore */
  }
  if (!streamed.includes("data:") && streamed.trim().length < 8) {
    throw new Error(
      `${label} chat stream empty/unexpected: ${streamed.slice(0, 500)}`,
    );
  }
  console.log(
    `[m9] ${label} chat stream OK`,
    streamed.slice(0, 100).replace(/\n/g, "\\n"),
  );

  const list = await fetch(`${baseUrl}/api/sessions`, { headers: { origin } });
  const listBody = await readJson(list);
  const sessions = (listBody.sessions as unknown[]) ?? [];
  if (!list.ok || sessions.length < 1) {
    throw new Error(
      `${label} sessions list failed: ${JSON.stringify(listBody).slice(0, 300)}`,
    );
  }

  const detail = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(String(created.sessionId))}`,
    { headers: { origin } },
  );
  const detailBody = await readJson(detail);
  if (!detail.ok || detailBody.sessionId !== created.sessionId) {
    throw new Error(
      `${label} session detail failed: ${JSON.stringify(detailBody).slice(0, 300)}`,
    );
  }

  const approvals = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(String(created.sessionId))}/approvals`,
    { headers: { origin } },
  );
  if (approvals.status >= 500) {
    throw new Error(`${label} approvals endpoint error: ${approvals.status}`);
  }
  console.log(`[m9] ${label} history+approvals OK`, approvals.status);
}

function assertSources(): void {
  const jbManager = readFileSync(
    join(
      repoRoot,
      "apps/jetbrains/src/main/kotlin/com/qenex/BridgeProcessManager.kt",
    ),
    "utf8",
  );
  if (jbManager.includes("acp-to-agui") || jbManager.includes("resolveBridgeBinary")) {
    throw new Error("JetBrains BridgeProcessManager still has Rust sidecar logic");
  }
  if (
    !jbManager.includes("QENEX_BRIDGE_PORT") ||
    !jbManager.includes("QENEX_CORS_ORIGINS")
  ) {
    throw new Error("JetBrains BridgeProcessManager missing Bun env markers");
  }
  if (!jbManager.includes("findRepoBridgeEntry")) {
    throw new Error("JetBrains BridgeProcessManager missing findRepoBridgeEntry");
  }
  console.log("[m9] JetBrains BridgeProcessManager source OK");

  const gradle = readFileSync(
    join(repoRoot, "apps/jetbrains/build.gradle.kts"),
    "utf8",
  );
  if (gradle.includes("qenex/bin") || gradle.includes('from("bin")')) {
    throw new Error("build.gradle.kts still packages Rust bin/");
  }
  if (!gradle.includes("qenex/bridge")) {
    throw new Error("build.gradle.kts missing qenex/bridge packaging");
  }
  console.log("[m9] JetBrains gradle packaging OK");

  const vsManager = readFileSync(
    join(repoRoot, "apps/vscode/src/bridge-manager.ts"),
    "utf8",
  );
  if (vsManager.includes("acp-to-agui")) {
    throw new Error("VS Code bridge-manager still references acp-to-agui");
  }
  if (
    !vsManager.includes("QENEX_BRIDGE_PORT") ||
    !vsManager.includes("QENEX_CORS_ORIGINS")
  ) {
    throw new Error("VS Code bridge-manager missing Bun env markers");
  }
  console.log("[m9] VS Code bridge-manager source OK");

  for (const gone of [
    "crates/bridge",
    "acp-to-agui",
    "apps/jetbrains/bin",
    "apps/vscode/bin",
  ]) {
    if (existsSync(resolve(repoRoot, gone))) {
      throw new Error(`expected absent: ${gone}`);
    }
  }
  console.log("[m9] legacy Rust/IDE bin paths absent OK");
}

let child: Subprocess | null = null;

try {
  assertSources();

  // --- JetBrains-style CORS (pageOrigin + localhost + null) ---
  {
    const port = await allocatePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const dbPath = join(
      mkdtempSync(join(tmpdir(), "qenex-m9-jb-db-")),
      "sessions.db",
    );
    const pageOrigin = "http://localhost:63342";
    const cors = [
      pageOrigin,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "null",
    ].join(",");

    child = await spawnBridge({
      label: "jetbrains",
      port,
      cors,
      dbPath,
    });
    await waitHealth(baseUrl);
    console.log("[m9] jetbrains bridge healthy");

    await assertCors(baseUrl, pageOrigin, "jetbrains");
    await assertCors(baseUrl, "null", "jetbrains-null-origin");
    await assertChatSurface(baseUrl, pageOrigin, "jetbrains");

    try {
      child.kill();
    } catch {
      /* ignore */
    }
    child = null;
  }

  // --- VS Code-style CORS (cspSource + localhost) ---
  {
    const port = await allocatePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const dbPath = join(
      mkdtempSync(join(tmpdir(), "qenex-m9-vs-db-")),
      "sessions.db",
    );
    const cspSource = "'self' https://*.vscode-cdn.net";
    const cors = [
      cspSource,
      "vscode-webview://*",
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ].join(",");

    child = await spawnBridge({
      label: "vscode",
      port,
      cors,
      dbPath,
    });
    await waitHealth(baseUrl);
    console.log("[m9] vscode bridge healthy");

    await assertCors(
      baseUrl,
      "https://file+.vscode-resource.vscode-cdn.net",
      "vscode-cdn",
    );
    await assertCors(
      baseUrl,
      "vscode-webview://abcdef00-1111-2222-3333-444444444444",
      "vscode-webview",
    );
    await assertChatSurface(
      baseUrl,
      "https://file+.vscode-resource.vscode-cdn.net",
      "vscode",
    );

    try {
      child.kill();
    } catch {
      /* ignore */
    }
    child = null;
  }

  console.log("M9_ACCEPTANCE_OK");
} catch (err) {
  console.error("[m9] FAILED", err);
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
