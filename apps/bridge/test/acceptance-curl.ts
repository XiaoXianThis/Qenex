/**
 * Curl-style acceptance script for Phase 1 / M0 checklist.
 * Spawns bridge on ephemeral port, exercises create → chat → delete.
 * Writes apps/bridge/artifacts/phase1-summary.json on success.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridgeServer } from "../src/server.ts";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const cwd = resolve(root, "test/fixtures/workspace");
const artifactsDir = resolve(root, "artifacts");
const dbPath = join(mkdtempSync(join(tmpdir(), "qenex-m0-")), "sessions.db");

const server = startBridgeServer({ hostname: "127.0.0.1", port: 0, dbPath });
console.log("bridge", server.url);

try {
  // create
  const createRes = await fetch(`${server.url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const createBody = await createRes.text();
  console.log("POST /api/sessions", createRes.status, createBody);
  if (createRes.status !== 201) process.exit(1);
  const { sessionId } = JSON.parse(createBody) as { sessionId: string };

  // chat
  const chatRes = await fetch(`${server.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [
            {
              type: "text",
              text: "Reply with one short sentence containing the word ACCEPT. No tools.",
            },
          ],
        },
      ],
    }),
  });
  const chatBody = await chatRes.text();
  console.log(
    "POST /api/chat",
    chatRes.status,
    "bytes=",
    chatBody.length,
    "sample=",
    chatBody.slice(0, 300),
  );
  const deltas: string[] = [];
  for (const line of chatBody.split("\n")) {
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
  console.log("reconstructed text:", text);
  if (chatRes.status !== 200 || !/accept/i.test(text)) {
    console.error("chat stream failed acceptance check");
    process.exit(1);
  }

  // delete
  const delRes = await fetch(`${server.url}/api/sessions/${sessionId}`, {
    method: "DELETE",
  });
  console.log("DELETE /api/sessions/:id", delRes.status, await delRes.text());
  if (delRes.status !== 200) process.exit(1);

  const chat2 = await fetch(`${server.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      messages: [
        { id: "u2", role: "user", parts: [{ type: "text", text: "nope" }] },
      ],
    }),
  });
  console.log("POST /api/chat after delete", chat2.status);
  if (chat2.status !== 404) process.exit(1);

  mkdirSync(artifactsDir, { recursive: true });
  const summary = {
    ok: true,
    phase: "M0/Phase1",
    acceptance: "PHASE1_CURL_ACCEPTANCE_OK",
    at: new Date().toISOString(),
    bridgeUrl: server.url,
    versions: {
      ai: "7.x",
      acpAiProvider: "0.3.4",
      bun: Bun.version,
    },
    apis: [
      "GET /health",
      "POST /api/sessions",
      "GET /api/sessions",
      "GET /api/sessions/:id",
      "DELETE /api/sessions/:id",
      "POST /api/chat",
    ],
    listen: "127.0.0.1",
    chatSample: text.slice(0, 200),
  };
  writeFileSync(
    resolve(artifactsDir, "phase1-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  writeFileSync(
    resolve(artifactsDir, "phase1-acceptance-output.txt"),
    [
      `bridge ${server.url}`,
      `POST /api/sessions 201`,
      `POST /api/chat 200 bytes=${chatBody.length}`,
      `reconstructed text: ${text}`,
      `DELETE /api/sessions/:id 200`,
      `POST /api/chat after delete 404`,
      "PHASE1_CURL_ACCEPTANCE_OK",
      "",
    ].join("\n"),
  );

  console.log("PHASE1_CURL_ACCEPTANCE_OK");
} finally {
  server.stop();
}
