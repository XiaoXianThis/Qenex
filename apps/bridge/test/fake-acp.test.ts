import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridgeServer } from "../src/server.ts";

const fixtureCwd = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/workspace",
);
const fakeAcp = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/fake-acp.ts",
);

function fakeCommand(): string[] {
  return [process.execPath, fakeAcp];
}

function tempDb(): string {
  return join(mkdtempSync(join(tmpdir(), "qenex-fake-acp-")), "sessions.db");
}

const server = startBridgeServer({
  hostname: "127.0.0.1",
  port: 0,
  dbPath: tempDb(),
});

afterAll(() => {
  server.stop({ wipe: true });
});

async function createSession(): Promise<{ sessionId: string; agent: string }> {
  const res = await fetch(`${server.url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cwd: fixtureCwd,
      agentId: "fake-acp",
      agentCommand: fakeCommand(),
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { sessionId: string; agent: string };
}

describe("fake ACP · session lifecycle", () => {
  test("POST /api/sessions creates a session without OpenCode", async () => {
    const json = await createSession();
    expect(json.agent).toBe("fake-acp");
    expect(json.sessionId.length).toBeGreaterThan(4);

    const one = await fetch(`${server.url}/api/sessions/${json.sessionId}`);
    expect(one.status).toBe(200);

    const list = await fetch(`${server.url}/api/sessions`);
    const body = (await list.json()) as { sessions: Array<{ sessionId: string }> };
    expect(body.sessions.some((s) => s.sessionId === json.sessionId)).toBe(true);
  }, 30_000);

  test("hibernate then ensureOpen reopens without OpenCode", async () => {
    const json = await createSession();
    const hibernate = await fetch(
      `${server.url}/api/sessions/${json.sessionId}/hibernate`,
      { method: "POST" },
    );
    expect(hibernate.status).toBe(200);
    expect(server.store.size).toBe(0);

    const entry = await server.store.ensureOpen(json.sessionId);
    expect(entry.info.sessionId).toBe(json.sessionId);
    expect(server.store.size).toBe(1);

    const res = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: json.sessionId,
        messages: [
          {
            id: "u-reopen",
            role: "user",
            parts: [{ type: "text", text: "ping after reopen" }],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw.toLowerCase()).toContain("bridge");
  }, 30_000);

  test("hibernate keeps history without a live ACP process", async () => {
    const json = await createSession();
    const hibernate = await fetch(
      `${server.url}/api/sessions/${json.sessionId}/hibernate`,
      { method: "POST" },
    );
    expect(hibernate.status).toBe(200);
    expect(server.store.getInfo(json.sessionId).sessionId).toBe(json.sessionId);
    const messages = server.store.getMessages(json.sessionId);
    expect(Array.isArray(messages)).toBe(true);
  }, 30_000);

  test("POST /api/chat streams fake text containing BRIDGE", async () => {
    const json = await createSession();
    const res = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: json.sessionId,
        messages: [
          {
            id: "u1",
            role: "user",
            parts: [{ type: "text", text: "ping" }],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw.includes("text-delta") || raw.includes("data:")).toBe(true);
    const deltas: string[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          text?: string;
        };
        if (evt.type === "text-delta") {
          deltas.push(String(evt.delta ?? evt.text ?? ""));
        }
      } catch {
        /* ignore */
      }
    }
    const text = deltas.join("");
    expect(text.toLowerCase()).toContain("bridge");
  }, 30_000);

  test("DELETE session then chat fails", async () => {
    const json = await createSession();
    const del = await fetch(`${server.url}/api/sessions/${json.sessionId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const chat = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: json.sessionId,
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "nope" }] },
        ],
      }),
    });
    expect(chat.status).toBe(404);
  }, 30_000);
});
