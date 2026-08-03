/**
 * CORS helpers for Desktop / IDE hosts that call Bridge cross-origin.
 * Origins from `QENEX_CORS_ORIGINS` (comma-separated). Empty = no CORS headers
 * (Web Vite proxy same-origin).
 */

function parseCorsOrigins(): string[] {
  const raw = process.env.QENEX_CORS_ORIGINS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function corsOrigins(): string[] {
  return parseCorsOrigins();
}

function allowOrigin(req: Request, origins: string[]): string | null {
  if (origins.length === 0) return null;
  const requestOrigin = req.headers.get("origin");
  if (!requestOrigin) {
    // Non-browser or same-origin; still useful for * when only localhost listed.
    return origins[0] ?? null;
  }
  if (origins.includes("*")) return requestOrigin;
  if (origins.includes(requestOrigin)) return requestOrigin;
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
