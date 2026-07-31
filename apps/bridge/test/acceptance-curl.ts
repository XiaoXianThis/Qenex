/**
 * Curl-style acceptance script for Phase 1 checklist.
 * Spawns bridge on ephemeral port, exercises create → chat → delete.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridgeServer } from "../src/server.ts";

const cwd = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/workspace",
);

const server = startBridgeServer({ hostname: "127.0.0.1", port: 0 });
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

  console.log("PHASE1_CURL_ACCEPTANCE_OK");
} finally {
  server.stop();
}
