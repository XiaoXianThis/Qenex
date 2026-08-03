/**
 * M6 guards: agents routes + multi-agent session create wiring.
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

describe("M6 · Bun agent domain", () => {
  test("agent module files exist", () => {
    for (const rel of [
      "apps/bridge/src/agent/routes.ts",
      "apps/bridge/src/agent/detect.ts",
      "apps/bridge/src/agent/registry.ts",
      "apps/bridge/src/agent/install.ts",
      "apps/bridge/src/agent/ensure.ts",
      "apps/bridge/src/agent/spawn.ts",
    ]) {
      expect(existsSync(resolve(repoRoot, rel))).toBe(true);
    }
  });

  test("server mounts /v2/agents and multi-agent create", () => {
    const server = read("apps/bridge/src/server.ts");
    expect(server).toContain("handleAgentRoutes");
    expect(server).toContain("agentId");
    expect(server).toContain("agentCommand");

    const store = read("apps/bridge/src/session-store.ts");
    expect(store).toContain("spawnAgentProvider");
    expect(store).toContain("agentId");
  });
});

describe("M6 · frontend multi-agent boot", () => {
  test("aisdk session create passes agentId", () => {
    const aisdk = read("packages/core/src/lib/aisdk-session.ts");
    expect(aisdk).toContain("agentId");
    expect(aisdk).toContain("agentCommand");
    expect(aisdk).toContain("pending:");
  });

  test("AgentRuntimeProvider boots with agentId", () => {
    const runtime = read("packages/ui/src/components/AgentRuntimeProvider.tsx");
    expect(runtime).toContain("agentId: session.agentId");
    expect(runtime).toContain("agentCommand: session.agentCommand");
  });

  test("tabs use pending sessionId placeholders", () => {
    const tabs = read("packages/core/src/store/tabs-store.ts");
    expect(tabs).toContain("pending:");
  });
});
