/**
 * Live M5 acceptance: session config get + mode/model set via ACP (OpenCode).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridgeServer } from "../src/server.ts";

const workspace = mkdtempSync(join(tmpdir(), "qenex-m5-ws-"));
const dbPath = join(mkdtempSync(join(tmpdir(), "qenex-m5-db-")), "sessions.db");

type ConfigBody = {
  sessionId?: string;
  modes?: Array<{ id: string; name: string }>;
  models?: Array<{ id: string; name: string }>;
  currentModeId?: string | null;
  currentModelId?: string | null;
  error?: { code?: string; message?: string };
};

try {
  const server = startBridgeServer({
    hostname: "127.0.0.1",
    port: 0,
    dbPath,
  });
  console.log("[m5] server", server.url);

  const create = await fetch(`${server.url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: workspace }),
  });
  const created = (await create.json()) as {
    sessionId?: string;
    modes?: unknown;
    models?: unknown;
    error?: { code?: string };
  };
  if (!create.ok || !created.sessionId) {
    throw new Error(`create failed: ${JSON.stringify(created)}`);
  }
  const sessionId = created.sessionId;
  console.log("[m5] created", sessionId);

  const cfgRes = await fetch(
    `${server.url}/api/sessions/${encodeURIComponent(sessionId)}/config`,
  );
  const cfg = (await cfgRes.json()) as ConfigBody;
  if (!cfgRes.ok) {
    throw new Error(`GET config failed: ${JSON.stringify(cfg)}`);
  }
  console.log("[m5] config modes", cfg.modes?.length ?? 0, "models", cfg.models?.length ?? 0);
  console.log("[m5] current", cfg.currentModeId, cfg.currentModelId);

  if (!Array.isArray(cfg.modes) || !Array.isArray(cfg.models)) {
    throw new Error("config missing modes/models arrays");
  }

  // OpenCode today advertises mode+model via ACP configOptions; require real catalogs.
  if (cfg.modes.length < 2) {
    throw new Error(
      `expected ≥2 modes from OpenCode configOptions, got ${cfg.modes.length}`,
    );
  }
  if (cfg.models.length < 2) {
    throw new Error(
      `expected ≥2 models from OpenCode configOptions, got ${cfg.models.length}`,
    );
  }
  if (!cfg.currentModeId || !cfg.currentModelId) {
    throw new Error("config missing currentModeId/currentModelId");
  }

  // Mode switch
  {
    const other =
      cfg.modes.find((m) => m.id !== cfg.currentModeId)?.id ?? cfg.modes[1]!.id;
    const modeRes = await fetch(
      `${server.url}/api/sessions/${encodeURIComponent(sessionId)}/mode`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modeId: other }),
      },
    );
    const modeBody = (await modeRes.json()) as ConfigBody;
    if (!modeRes.ok) {
      throw new Error(`set mode failed: ${JSON.stringify(modeBody)}`);
    }
    if (modeBody.currentModeId !== other) {
      throw new Error(
        `mode not updated: want ${other}, got ${modeBody.currentModeId}`,
      );
    }
    const again = await fetch(
      `${server.url}/api/sessions/${encodeURIComponent(sessionId)}/config`,
    );
    const againBody = (await again.json()) as ConfigBody;
    if (againBody.currentModeId !== other) {
      throw new Error(`GET config mode mismatch after set: ${againBody.currentModeId}`);
    }
    console.log("[m5] mode switch ok →", other);
  }

  // Model switch
  {
    const other =
      cfg.models.find((m) => m.id !== cfg.currentModelId)?.id ??
      cfg.models[1]!.id;
    const modelRes = await fetch(
      `${server.url}/api/sessions/${encodeURIComponent(sessionId)}/model`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId: other }),
      },
    );
    const modelBody = (await modelRes.json()) as ConfigBody;
    if (!modelRes.ok) {
      throw new Error(`set model failed: ${JSON.stringify(modelBody)}`);
    }
    if (modelBody.currentModelId !== other) {
      throw new Error(
        `model not updated: want ${other}, got ${modelBody.currentModelId}`,
      );
    }
    const again = await fetch(
      `${server.url}/api/sessions/${encodeURIComponent(sessionId)}/config`,
    );
    const againBody = (await again.json()) as ConfigBody;
    if (againBody.currentModelId !== other) {
      throw new Error(
        `GET config model mismatch after set: ${againBody.currentModelId}`,
      );
    }
    console.log("[m5] model switch ok →", other);
  }

  // Validation errors
  const badMode = await fetch(
    `${server.url}/api/sessions/${encodeURIComponent(sessionId)}/mode`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (badMode.status !== 400) {
    throw new Error(`expected 400 for missing modeId, got ${badMode.status}`);
  }

  // Cold reopen: OpenCode loadSession omits configOptions; catalog must still appear.
  {
    server.stop(); // dispose live ACP, keep SQLite
    const server2 = startBridgeServer({
      hostname: "127.0.0.1",
      port: 0,
      dbPath,
    });
    console.log("[m5] server2 (reopen)", server2.url);
    const cold = await fetch(
      `${server2.url}/api/sessions/${encodeURIComponent(sessionId)}/config`,
    );
    const coldBody = (await cold.json()) as ConfigBody;
    if (!cold.ok) {
      throw new Error(`cold GET config failed: ${JSON.stringify(coldBody)}`);
    }
    if ((coldBody.modes?.length ?? 0) < 2 || (coldBody.models?.length ?? 0) < 2) {
      throw new Error(
        `cold reopen missing catalogs: modes=${coldBody.modes?.length} models=${coldBody.models?.length}`,
      );
    }
    console.log(
      "[m5] cold reopen config ok",
      coldBody.modes?.length,
      coldBody.models?.length,
      coldBody.currentModeId,
      coldBody.currentModelId,
    );
    await fetch(`${server2.url}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    server2.stop({ wipe: true });
  }

  console.log("M5_ACCEPTANCE_OK");
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
