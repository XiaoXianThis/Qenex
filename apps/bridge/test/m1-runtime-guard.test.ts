/**
 * M1 guards: no AG-UI runtime deps; AI SDK runtime wiring present.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("M1 · AG-UI removed from package manifests", () => {
  test("packages/core and packages/ui do not depend on AG-UI", () => {
    const core = JSON.parse(read("packages/core/package.json")) as {
      dependencies: Record<string, string>;
    };
    const ui = JSON.parse(read("packages/ui/package.json")) as {
      dependencies: Record<string, string>;
    };
    for (const deps of [core.dependencies, ui.dependencies]) {
      expect(deps["@ag-ui/client"]).toBeUndefined();
      expect(deps["@assistant-ui/react-ag-ui"]).toBeUndefined();
    }
    expect(ui.dependencies["@assistant-ui/react-ai-sdk"]).toBeTruthy();
    expect(ui.dependencies["@ai-sdk/react"]).toBeTruthy();
    expect(ui.dependencies["ai"]).toBeTruthy();
  });

  test("apps/web does not depend on AG-UI", () => {
    const web = JSON.parse(read("apps/web/package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(web.dependencies["@ag-ui/client"]).toBeUndefined();
    expect(web.dependencies["@assistant-ui/react-ag-ui"]).toBeUndefined();
  });
});

describe("M1 · no AG-UI imports in fusion packages", () => {
  test("core/ui/web source does not import AG-UI packages", () => {
    const roots = [
      resolve(repoRoot, "packages/core/src"),
      resolve(repoRoot, "packages/ui/src"),
      resolve(repoRoot, "apps/web/src"),
    ];
    const banned = [
      "@ag-ui/client",
      "@ag-ui/core",
      "@assistant-ui/react-ag-ui",
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walkTsFiles(root)) {
        const src = readFileSync(file, "utf8");
        for (const pkg of banned) {
          if (src.includes(`from "${pkg}"`) || src.includes(`from '${pkg}'`)) {
            offenders.push(`${file} → ${pkg}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("M1 · runtime source wiring", () => {
  test("AgentRuntimeProvider uses AI SDK chat transport + session dedupe", () => {
    const src = read("packages/ui/src/components/AgentRuntimeProvider.tsx");
    expect(src).toContain("useAISDKRuntime");
    expect(src).toContain("AssistantChatTransport");
    expect(src).toContain("useChat");
    expect(src).toContain("ensureAisdkSession");
    expect(src).toContain("getAisdkSession");
    expect(src).toContain("/api/chat");
    expect(src).not.toContain("useAgUiRuntime");
    expect(src).not.toContain("BridgeHttpAgent");
    expect(src).not.toContain("ChangesRefreshBridge");
  });

  test("thread uses AisdkThreadMessages + formatBridgeError", () => {
    const thread = read("packages/ui/src/components/assistant-ui/thread.tsx");
    expect(thread).toContain("AisdkThreadMessages");
    expect(thread).toContain("formatBridgeError");
    expect(thread).toContain("useChatHelpers");
    expect(thread).not.toContain("ChangesPanel");
    expect(thread).not.toContain("rewindTask");
    expect(thread).not.toContain("还原到此消息前");
  });

  test("checkpoint / Changes UI entry points are gone", () => {
    expect(
      existsSync(resolve(repoRoot, "packages/ui/src/layout/panels/ChangesPanel.tsx")),
    ).toBe(false);
    expect(
      existsSync(resolve(repoRoot, "packages/core/src/store/changes-store.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(repoRoot, "packages/core/src/lib/git-session-mode.ts")),
    ).toBe(false);
  });

  test("AG-UI modules deleted", () => {
    expect(
      existsSync(resolve(repoRoot, "packages/core/src/lib/bridge-agent.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(repoRoot, "packages/core/src/lib/replay-agui-events.ts")),
    ).toBe(false);
    expect(
      existsSync(
        resolve(repoRoot, "packages/core/src/lib/bridge-history-adapter.ts"),
      ),
    ).toBe(false);
  });

  test("aisdk-session exports dedupe helpers", () => {
    const src = read("packages/core/src/lib/aisdk-session.ts");
    expect(src).toContain("export function ensureAisdkSession");
    expect(src).toContain("export function invalidateSessionBoot");
    expect(src).toContain("export function formatBridgeError");
  });
});
