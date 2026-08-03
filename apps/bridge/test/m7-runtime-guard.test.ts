/**
 * M7 guards: Bun Bridge sidecar on Desktop, CORS, Host contract.
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

describe("M7 · CORS", () => {
  test("cors module exists and is wired", () => {
    expect(existsSync(resolve(repoRoot, "apps/bridge/src/cors.ts"))).toBe(true);
    const server = read("apps/bridge/src/server.ts");
    expect(server).toContain("withCors");
    expect(server).toContain("corsPreflightResponse");
    const cors = read("apps/bridge/src/cors.ts");
    expect(cors).toContain("QENEX_CORS_ORIGINS");
  });
});

describe("M7 · Desktop Bun Bridge", () => {
  test("bridge.rs spawns bun, not acp-to-agui", () => {
    const bridge = read("apps/desktop/src-tauri/src/bridge.rs");
    expect(bridge).not.toContain("acp-to-agui");
    expect(bridge).not.toContain("sidecar(");
    expect(bridge).toContain("QENEX_BRIDGE_PORT");
    expect(bridge).toContain("QENEX_CORS_ORIGINS");
    expect(bridge).toContain("find_bun");
    expect(bridge).toContain("resolve_bridge_entry");
  });

  test("tauri.conf bundles bridge source, no externalBin", () => {
    const conf = read("apps/desktop/src-tauri/tauri.conf.json");
    expect(conf).not.toContain("externalBin");
    expect(conf).not.toContain("acp-to-agui");
    expect(conf).toContain("bridge/src");
    expect(conf).toContain("bridge/package.json");
  });

  test("capabilities drop sidecar spawn permission", () => {
    const caps = read("apps/desktop/src-tauri/capabilities/default.json");
    expect(caps).not.toContain("acp-to-agui");
    expect(caps).not.toContain("shell:allow-spawn");
  });

  test("dev/build/verify scripts no longer build Rust sidecar", () => {
    for (const rel of [
      "scripts/dev-desktop.mjs",
      "scripts/build-desktop.mjs",
      "scripts/verify-desktop.mjs",
    ]) {
      const src = read(rel);
      expect(src).not.toContain("crates/bridge");
      expect(src).not.toMatch(/cargo build.*acp-to-agui/);
    }
  });

  test("Host.getBridgeBaseUrl contract unchanged", () => {
    const host = read("apps/desktop/src/host/tauri-host.ts");
    expect(host).toContain("getBridgeBaseUrl");
    expect(host).toContain('invoke<string>("cmd_get_bridge_url")');
    const platform = read("packages/platform/src/host.ts");
    expect(platform).toContain("getBridgeBaseUrl(): Promise<string>");
  });
});
