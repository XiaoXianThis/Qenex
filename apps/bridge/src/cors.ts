/**
 * CORS helpers for Desktop / IDE hosts that call Bridge cross-origin.
 * Origins from `QENEX_CORS_ORIGINS` (comma-separated). Empty = no CORS headers
 * (Web Vite proxy same-origin).
 *
 * VS Code passes `webview.cspSource`, which may look like:
 *   `'self' https://*.vscode-cdn.net`
 * We tokenize that and also support:
 *   - exact origins
 *   - `https://*.host.tld` (any subdomain of host.tld)
 *   - `vscode-webview://*` (reflect any vscode-webview:// origin)
 */

const CSP_KEYWORDS = new Set([
  "'self'",
  "'none'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'wasm-unsafe-eval'",
  "self",
  "none",
]);

function parseCorsOrigins(): string[] {
  const raw = process.env.QENEX_CORS_ORIGINS ?? "";
  const tokens: string[] = [];
  for (const chunk of raw.split(",")) {
    for (const part of chunk.trim().split(/\s+/)) {
      const t = part.trim();
      if (!t || CSP_KEYWORDS.has(t)) continue;
      tokens.push(t);
    }
  }
  return tokens;
}

export function corsOrigins(): string[] {
  return parseCorsOrigins();
}

/** Match `https://*.example.com` against any https origin whose host is example.com or *.example.com */
function matchHostWildcard(pattern: string, requestOrigin: string): boolean {
  const m = pattern.match(/^(https?):\/\/\*\.([^/]+)$/i);
  if (!m) return false;
  try {
    const url = new URL(requestOrigin);
    if (url.protocol !== `${m[1].toLowerCase()}:`) return false;
    const suffix = m[2].toLowerCase();
    const host = url.hostname.toLowerCase();
    return host === suffix || host.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
}

function patternAllows(pattern: string, requestOrigin: string): boolean {
  if (pattern === "*" || pattern === requestOrigin) return true;
  if (pattern === "vscode-webview://*" || pattern === "vscode-webview:") {
    return requestOrigin.startsWith("vscode-webview://");
  }
  if (pattern.includes("://*.")) {
    return matchHostWildcard(pattern, requestOrigin);
  }
  return false;
}

function allowOrigin(req: Request, origins: string[]): string | null {
  if (origins.length === 0) return null;
  const requestOrigin = req.headers.get("origin");
  if (!requestOrigin) {
    // Non-browser or same-origin; still useful for * when only localhost listed.
    return origins.find((o) => !o.includes("*") && !o.startsWith("vscode-webview:")) ??
      origins[0] ??
      null;
  }
  for (const pattern of origins) {
    if (patternAllows(pattern, requestOrigin)) {
      return requestOrigin;
    }
  }
  return null;
}

export function withCors(
  req: Request,
  response: Response,
  origins = parseCorsOrigins(),
): Response {
  const allowed = allowOrigin(req, origins);
  if (!allowed) return response;

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowed);
  headers.set("access-control-allow-credentials", "true");
  headers.set(
    "access-control-allow-headers",
    req.headers.get("access-control-request-headers") ??
      "content-type, authorization, x-qenex-session-id",
  );
  headers.set(
    "access-control-allow-methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  headers.set("vary", "origin");

  // Chromium Private Network Access preflight (some hosts / future VS Code)
  if (req.headers.get("access-control-request-private-network") === "true") {
    headers.set("access-control-allow-private-network", "true");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function corsPreflightResponse(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  const origins = parseCorsOrigins();
  if (origins.length === 0) {
    return new Response(null, { status: 204 });
  }
  return withCors(req, new Response(null, { status: 204 }), origins);
}
