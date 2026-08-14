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

  test("tauri.conf bundles staged bridge runtime, no externalBin", () => {
    const conf = read("apps/desktop/src-tauri/tauri.conf.json");
    expect(conf).not.toContain("externalBin");
    expect(conf).not.toContain("acp-to-agui");
    expect(conf).toContain('"../bridge": "bridge"');
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

describe("Cross-platform runtime stability", () => {
  test("packaged hosts use a build-time bundle and exact runtime versions", () => {
    const stage = read("scripts/lib/stage-bun-bridge.mjs");
    expect(stage).toContain('"build"');
    expect(stage).toContain('"index.js"');
    expect(stage).not.toContain('"install"');

    const pkg = JSON.parse(read("apps/bridge/package.json")) as {
      dependencies: Record<string, string>;
    };
    for (const version of Object.values(pkg.dependencies)) {
      expect(version).not.toMatch(/^[~^]/);
    }
  });

  test("Desktop can recover from startup failure and uses native PATH rules", () => {
    const bridge = read("apps/desktop/src-tauri/src/bridge.rs");
    expect(bridge).toContain("BridgeState::failed");
    expect(bridge).toContain("restart_bridge");
    expect(bridge).toContain("generation");
    expect(bridge).toContain("std::env::split_paths");
    expect(bridge).toContain('if cfg!(windows) { "bun.exe" }');
    expect(bridge).not.toContain("bun install");
  });

  test("IDE hosts report startup failures and invalidate dead Bridge URLs", () => {
    const vscodeManager = read("apps/vscode/src/bridge-manager.ts");
    const vscodeHost = read("apps/vscode/webview/src/host/vscode-host.ts");
    const jetbrainsManager = read(
      "apps/jetbrains/src/main/kotlin/com/qenex/BridgeProcessManager.kt",
    );
    const jetbrainsHost = read(
      "apps/jetbrains/webview/src/host/jetbrains-host.ts",
    );

    expect(vscodeManager).toContain("bun.exe");
    expect(vscodeManager).toContain("exitedEarly");
    expect(vscodeHost).toContain('case "bridge-error"');
    expect(vscodeHost).toContain("bridgeBaseUrl = null");
    expect(vscodeHost).toContain("bridge.origin");
    expect(vscodeHost).toContain("wasAborted");
    expect(jetbrainsManager).toContain('getResource("qenex/bridge/index.js")');
    expect(jetbrainsManager).toContain("watchProcess");
    expect(jetbrainsManager).not.toContain("bun install");
    expect(jetbrainsHost).toContain('message.type === "bridge-error"');
    expect(jetbrainsHost).toContain("bridgeBaseUrl = null");
    expect(jetbrainsHost).toContain("bridge.origin");
    expect(jetbrainsHost).toContain("wasAborted");
  });

  test("JetBrains shares the webview server across multiple panels", () => {
    const panel = read(
      "apps/jetbrains/src/main/kotlin/com/qenex/QenexPanel.kt",
    );
    const loader = read(
      "apps/jetbrains/src/main/kotlin/com/qenex/WebviewResourceLoader.kt",
    );
    expect(panel).toContain("WebviewHttpServer.release()");
    expect(loader).toContain("clients += 1");
    expect(loader).toContain("if (clients == 0) stopLocked()");
  });

  test("session initialization and all core Bridge requests are bounded", () => {
    const store = read("apps/bridge/src/session-store.ts");
    const client = read("packages/core/src/lib/aisdk-session.ts");
    expect(store).toContain("SESSION_INIT_TIMEOUT_MS");
    expect(store).toContain("request_aborted");
    expect(client).toContain("AbortSignal.timeout(60_000)");
    expect(client.match(/host\.fetch\(/g)?.length).toBe(1);
  });

  test("server package waits for Bridge health before opening the UI", () => {
    const runner = read("scripts/templates/server-run.mjs");
    expect(runner).toContain("waitForBridge");
    expect(runner).toContain("/health");
    expect(runner).toContain('rel.startsWith("..")');
  });
});
