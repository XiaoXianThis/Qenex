/**
 * M2 guards: approval REST client + Ask/Auto wiring (no AG-UI /v2 approval path in UI).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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

describe("M2 · Bridge approval surface", () => {
  test("ApprovalManager + chat approvalMode exist", () => {
    expect(existsSync(resolve(repoRoot, "apps/bridge/src/approval-manager.ts"))).toBe(
      true,
    );
    const chat = read("apps/bridge/src/chat.ts");
    expect(chat).toContain("approvalMode");
    const server = read("apps/bridge/src/server.ts");
    expect(server).toContain("/approvals");
  });

  test("phase3 acceptance script present", () => {
    expect(existsSync(resolve(repoRoot, "apps/bridge/test/phase3-acceptance.ts"))).toBe(
      true,
    );
    const pkg = JSON.parse(read("apps/bridge/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:phase3"]).toBeTruthy();
  });
});

describe("M2 · frontend wiring", () => {
  test("aisdk-session exposes approval REST helpers", () => {
    const src = read("packages/core/src/lib/aisdk-session.ts");
    expect(src).toContain("export async function listPendingApprovals");
    expect(src).toContain("export async function respondToApproval");
    expect(src).toContain("export type ApprovalMode");
    expect(src).toContain("approvalModeFromAutoAllow");
  });

  test("AgentRuntimeProvider sends approvalMode and mounts poll bridge", () => {
    const src = read("packages/ui/src/components/AgentRuntimeProvider.tsx");
    expect(src).toContain("approvalMode");
    expect(src).toContain("ApprovalPollBridge");
    expect(src).toContain("approvalModeFromAutoAllow");
  });

  test("ApprovalPanel uses respondToApproval (not /v2 sendApproval)", () => {
    const src = read("packages/ui/src/layout/panels/ApprovalPanel.tsx");
    expect(src).toContain("respondToApproval");
    expect(src).toContain("approval.approvalId");
    expect(src).toContain("需要审批");
    expect(src).not.toContain("sendApproval");
    expect(src).not.toContain("getPendingApproval");
    expect(src).not.toContain("/v2/tasks");
  });

  test("Ask/Auto toggle present in composer thread", () => {
    const toggle = read("packages/ui/src/components/ApprovalModeToggle.tsx");
    expect(toggle).toContain("Ask");
    expect(toggle).toContain("Auto");
    const thread = read("packages/ui/src/components/assistant-ui/thread.tsx");
    expect(thread).toContain("ApprovalModeToggle");
    expect(thread).not.toContain("模型等待你的审批");
    expect(thread).not.toContain("否则会一直停住");
  });

  test("UI sources do not call legacy /v2 approval endpoints", () => {
    const roots = [
      resolve(repoRoot, "packages/ui/src"),
      resolve(repoRoot, "apps/web/src"),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walkTsFiles(root)) {
        const src = readFileSync(file, "utf8");
        if (src.includes("/v2/tasks/") && src.includes("approval")) {
          offenders.push(file);
        }
        if (
          src.includes('from "@qenex/core"') &&
          /\bsendApproval\b/.test(src) &&
          file.includes("ApprovalPanel")
        ) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
