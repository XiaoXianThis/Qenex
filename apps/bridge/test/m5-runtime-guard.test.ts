/**
 * M5 guards: config/mode/model REST; no AG-UI ModeSync /v2 mode paths in UI path.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("M5 · Bridge config API", () => {
  test("config / mode / model / dynamic option routes exist", () => {
    expect(
      existsSync(resolve(repoRoot, "apps/bridge/src/session-config-dto.ts")),
    ).toBe(true);
    const server = read("apps/bridge/src/server.ts");
    expect(server).toContain("/config");
    expect(server).toContain("/mode");
    expect(server).toContain("/model");
    expect(server).toContain("/config-option");
    expect(server).toContain("/probe-model-config");
    expect(server).toContain("/probe-models-config");
    expect(server).toContain("models\\/");
    expect(server).toContain("getModelConfig");
    expect(server).toContain("getConfig");
    expect(server).toContain("setMode");
    expect(server).toContain("setModel");

    const store = read("apps/bridge/src/session-store.ts");
    expect(store).toContain("provider.setMode");
    expect(store).toContain("provider.setModel");
    expect(store).toContain("setSessionConfigOption");
    expect(store).toContain("probeModelConfig");
    expect(store).toContain("normalizeAcpSessionConfig");
    expect(
      existsSync(resolve(repoRoot, "apps/bridge/src/acp-session-config.ts")),
    ).toBe(true);
  });
});

describe("M5 · frontend uses aisdk session config", () => {
  test("SessionConfigContext boots from /api/sessions config", () => {
    const ctx = read("packages/core/src/context/SessionConfigContext.tsx");
    expect(ctx).toContain("getAisdkSessionConfig");
    expect(ctx).toContain("setAisdkSessionMode");
    expect(ctx).toContain("setAisdkSessionModel");
    expect(ctx).toContain("setAisdkSessionConfigOption");
    expect(ctx).toContain("getAisdkSessionModelConfig");
    expect(ctx).not.toContain('from "../lib/bridge-api.ts";\n  getSessionConfig');
    // Must not call fusion /v2 mode setters for primary path
    expect(ctx).not.toMatch(/\bsetMode\(threadId/);
    expect(ctx).not.toMatch(/\bsetModel\(threadId/);
    expect(ctx).not.toContain("ModeSyncBridge");
    expect(ctx).not.toContain("agent:mode_update");
  });

  test("aisdk-session exposes config helpers", () => {
    const aisdk = read("packages/core/src/lib/aisdk-session.ts");
    expect(aisdk).toContain("getAisdkSessionConfig");
    expect(aisdk).toContain("/config");
    expect(aisdk).toContain("/mode");
    expect(aisdk).toContain("/model");
    expect(aisdk).toContain("/config-option");
    expect(aisdk).toContain("getAisdkSessionModelConfig");
    expect(aisdk).toContain("/models/");
  });

  test("ModeSyncBridge is gone", () => {
    expect(
      existsSync(
        resolve(repoRoot, "packages/ui/src/components/ModeSyncBridge.tsx"),
      ),
    ).toBe(false);
  });
});
