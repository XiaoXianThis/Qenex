/**
 * Integrated server runner for `build/` packages.
 * Starts Bun Bridge and serves `web/` with API proxy.
 *
 * Env:
 *   QENEX_BRIDGE_HOST (default 127.0.0.1)
 *   QENEX_BRIDGE_PORT (default 8000)
 *   QENEX_WEB_PORT    (default 3000)
 */
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "bun";

const root = import.meta.dir;
const bridgeDir = join(root, "bridge");
const webDir = join(root, "web");
const bridgeEntry = join(bridgeDir, "index.js");

if (!existsSync(bridgeEntry)) {
  console.error(`Missing ${bridgeEntry}`);
  process.exit(1);
}
if (!existsSync(webDir)) {
  console.error(`Missing ${webDir}`);
  process.exit(1);
}

const bridgeHost = process.env.QENEX_BRIDGE_HOST || "127.0.0.1";
const bridgePort = Number(process.env.QENEX_BRIDGE_PORT || 8000);
const webPort = Number(process.env.QENEX_WEB_PORT || 3000);

const child = spawn({
  cmd: ["bun", bridgeEntry],
  cwd: bridgeDir,
  env: {
    ...process.env,
    QENEX_BRIDGE_HOST: bridgeHost,
    QENEX_BRIDGE_PORT: String(bridgePort),
  },
  stdout: "inherit",
  stderr: "inherit",
});

async function waitForBridge(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Bridge exited during startup (${child.exitCode})`);
    }
    try {
      const response = await fetch(`http://${bridgeHost}:${bridgePort}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await Bun.sleep(200);
  }
  throw new Error(`Bridge health check timed out: ${lastError}`);
}

function shutdown(signal) {
  console.log(`[qenex] ${signal}, shutting down…`);
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".ico": "image/x-icon",
};

function contentType(pathname) {
  const i = pathname.lastIndexOf(".");
  if (i < 0) return "application/octet-stream";
  return MIME[pathname.slice(i).toLowerCase()] ?? "application/octet-stream";
}

function shouldProxy(pathname) {
  return (
    pathname === "/health" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/v2/")
  );
}

async function proxyToBridge(req, url) {
  const target = `http://${bridgeHost}:${bridgePort}${url.pathname}${url.search}`;
  const init = {
    method: req.method,
    headers: req.headers,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }
  return fetch(target, init);
}

async function serveStatic(url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  if (pathname === "/") pathname = "/index.html";

  const filePath = resolve(webDir, pathname.replace(/^\//, ""));
  const rel = relative(webDir, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "content-type": contentType(pathname) },
    });
  }

  // SPA fallback
  const index = Bun.file(join(webDir, "index.html"));
  if (await index.exists()) {
    return new Response(index, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response("Not Found", { status: 404 });
}

try {
  await waitForBridge();
} catch (error) {
  console.error(`[qenex] ${error}`);
  child.kill();
  process.exit(1);
}

Bun.serve({
  hostname: "127.0.0.1",
  port: webPort,
  async fetch(req) {
    const url = new URL(req.url);
    if (shouldProxy(url.pathname)) {
      try {
        return await proxyToBridge(req, url);
      } catch (err) {
        return new Response(`Bridge proxy error: ${err}`, { status: 502 });
      }
    }
    return serveStatic(url);
  },
});

console.log(`[qenex] Bridge → http://${bridgeHost}:${bridgePort}`);
console.log(`[qenex] Web    → http://127.0.0.1:${webPort}`);
console.log(`[qenex] Open http://127.0.0.1:${webPort} in your browser`);

const code = await child.exited;
process.exit(code ?? 0);
