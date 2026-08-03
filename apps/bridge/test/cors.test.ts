import { describe, expect, test } from "bun:test";
import { withCors, corsPreflightResponse } from "../src/cors.ts";

describe("cors helpers", () => {
  test("withCors sets ACAO for allowed origin", () => {
    process.env.QENEX_CORS_ORIGINS = "http://localhost:1420";
    const req = new Request("http://127.0.0.1:8000/health", {
      headers: { origin: "http://localhost:1420" },
    });
    const res = withCors(req, Response.json({ ok: true }));
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:1420",
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("withCors does not reflect disallowed origin", () => {
    process.env.QENEX_CORS_ORIGINS = "http://localhost:1420";
    const req = new Request("http://127.0.0.1:8000/health", {
      headers: { origin: "https://evil.example" },
    });
    const res = withCors(req, Response.json({ ok: true }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("preflight returns 204 with CORS when configured", () => {
    process.env.QENEX_CORS_ORIGINS = "https://tauri.localhost";
    const req = new Request("http://127.0.0.1:8000/api/sessions", {
      method: "OPTIONS",
      headers: {
        origin: "https://tauri.localhost",
        "access-control-request-method": "POST",
      },
    });
    const res = corsPreflightResponse(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(204);
    expect(res!.headers.get("access-control-allow-origin")).toBe(
      "https://tauri.localhost",
    );
  });

  test("empty CORS origins skips ACAO on normal responses", () => {
    process.env.QENEX_CORS_ORIGINS = "";
    const req = new Request("http://127.0.0.1:8000/health", {
      headers: { origin: "http://localhost:3000" },
    });
    const res = withCors(req, Response.json({ ok: true }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
