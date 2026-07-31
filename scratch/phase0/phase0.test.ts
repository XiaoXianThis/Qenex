import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  OPENCODE_BIN,
  WORKSPACE,
  createOpenCodeProvider,
  collectFullStream,
  emptyCensus,
  installPermissionProbe,
  countOpenCodeAcpProcesses,
  type PermissionRequestLog,
} from "./src/shared.ts";
import { generateText, streamText } from "ai";
import { join } from "node:path";
import { existsSync as fsExists, readFileSync, unlinkSync } from "node:fs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));

describe("Phase 0 environment", () => {
  test("opencode is on PATH and supports acp", () => {
    expect(Bun.which("opencode") || OPENCODE_BIN).toBeTruthy();
    expect(existsSync(WORKSPACE)).toBe(true);
  });

  test("ai@7 and acp-ai-provider import cleanly", async () => {
    const ai = await import("ai");
    const acp = await import("@mcpc-tech/acp-ai-provider");
    expect(typeof ai.streamText).toBe("function");
    expect(typeof ai.generateText).toBe("function");
    expect(typeof acp.createACPProvider).toBe("function");

    const aiPkg = await Bun.file(
      resolve(root, "node_modules/ai/package.json"),
    ).json();
    expect(aiPkg.version.startsWith("7.")).toBe(true);
  });
});

describe("Phase 0 OpenCode ACP integration", () => {
  test(
    "initSession + single-turn stream contains text",
    async () => {
      const provider = createOpenCodeProvider({ persistSession: true });
      try {
        const session = await provider.initSession();
        expect(session.sessionId).toBeTruthy();

        const result = streamText({
          model: provider.languageModel(),
          prompt:
            "Reply with exactly one short English sentence that includes the word PONG. No tools.",
          tools: provider.tools,
          includeRawChunks: true,
        });
        const { text, census } = await collectFullStream(
          result.fullStream as AsyncIterable<{
            type: string;
            [k: string]: unknown;
          }>,
        );
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text.toLowerCase()).toContain("pong");
        expect(census.textChars + census.textChunks).toBeGreaterThan(0);
      } finally {
        provider.cleanup();
      }
    },
    { timeout: 180_000 },
  );

  test(
    "persistSession multi-turn remembers secret",
    async () => {
      const secret = `QX-TEST-${Date.now().toString(36).toUpperCase()}`;
      const provider = createOpenCodeProvider({ persistSession: true });
      try {
        await provider.initSession();
        await generateText({
          model: provider.languageModel(),
          prompt: `Remember this secret code exactly: ${secret}. Reply with only: ACK`,
          tools: provider.tools,
        });
        const turn2 = await generateText({
          model: provider.languageModel(),
          prompt:
            "What was the secret code I just asked you to remember? Reply with the code only.",
          tools: provider.tools,
        });
        expect(turn2.text).toContain(secret);
      } finally {
        provider.cleanup();
      }
    },
    { timeout: 240_000 },
  );

  test(
    "in-workspace write: tools in stream; usually no ACP permission RPC",
    async () => {
      const target = join(WORKSPACE, "spike-test-write.txt");
      const marker = `marker-${Date.now()}`;
      if (fsExists(target)) unlinkSync(target);

      const permissionLog: PermissionRequestLog[] = [];
      const provider = createOpenCodeProvider({
        persistSession: true,
        env: { ACP_AI_PROVIDER_DEBUG: "1" },
      });
      try {
        await provider.initSession();
        installPermissionProbe(provider, permissionLog, "allow-first");

        const result = streamText({
          model: provider.languageModel(),
          prompt: `Create file spike-test-write.txt in the workspace with exact content: ${marker}. Then say DONE.`,
          tools: provider.tools,
          includeRawChunks: true,
        });
        const { text, census } = await collectFullStream(
          result.fullStream as AsyncIterable<{
            type: string;
            [k: string]: unknown;
          }>,
          emptyCensus(),
        );

        const fileOk =
          fsExists(target) && readFileSync(target, "utf8").includes(marker);
        const acted =
          census.toolCalls > 0 || permissionLog.length > 0 || fileOk;

        expect(acted).toBe(true);
        expect(text.trim().length).toBeGreaterThan(0);
        expect(census.partTypes["approval-requested"] ?? 0).toBe(0);
      } finally {
        provider.cleanup();
      }
    },
    { timeout: 300_000 },
  );

  test(
    "outside-cwd write: ACP requestPermission fires; still no AI SDK approval-requested",
    async () => {
      const { tmpdir } = await import("node:os");
      const outside = join(tmpdir(), `qenex-phase0-test-${Date.now()}.txt`);
      const marker = `out-${Date.now()}`;
      const permissionLog: PermissionRequestLog[] = [];
      const provider = createOpenCodeProvider({ persistSession: true });
      try {
        await provider.initSession();
        installPermissionProbe(provider, permissionLog, "allow-first");

        const result = streamText({
          model: provider.languageModel(),
          prompt: `Write a file at absolute path ${outside} with exact content: ${marker}. Then say DONE.`,
          tools: provider.tools,
          includeRawChunks: true,
        });
        const { text, census } = await collectFullStream(
          result.fullStream as AsyncIterable<{
            type: string;
            [k: string]: unknown;
          }>,
          emptyCensus(),
        );

        expect(permissionLog.length).toBeGreaterThan(0);
        const opts = (
          permissionLog[0]?.params as {
            options?: Array<{ optionId: string; kind?: string }>;
          }
        )?.options;
        expect(opts?.some((o) => o.optionId === "once")).toBe(true);
        expect(opts?.some((o) => o.optionId === "reject")).toBe(true);
        expect(census.partTypes["approval-requested"] ?? 0).toBe(0);
        expect(census.toolCalls).toBeGreaterThan(0);
        expect(text.trim().length).toBeGreaterThan(0);

        await Bun.write(
          resolve(root, "artifacts/phase0-bun-test-findings.json"),
          JSON.stringify(
            {
              inWorkspacePermissionUsuallySkipped: true,
              outsideCwdPermissionViaAcpCallback: true,
              approvalRequestedInAiSdkStream: false,
              permissionOptions: opts,
              toolCalls: census.toolCalls,
              partTypes: census.partTypes,
              note: "Phase 3 must bridge ACP requestPermission → UI cards; AI SDK toolApproval alone is insufficient for OpenCode.",
            },
            null,
            2,
          ),
        );
      } finally {
        provider.cleanup();
        if (fsExists(outside)) {
          try {
            unlinkSync(outside);
          } catch {
            /* ignore */
          }
        }
      }
    },
    { timeout: 300_000 },
  );

  test(
    "cleanup() kills agent process",
    async () => {
      const before = await countOpenCodeAcpProcesses();
      const provider = createOpenCodeProvider({ persistSession: true });
      let pid: number | null = null;
      try {
        await provider.initSession();
        const model = provider.languageModel() as unknown as {
          agentProcess?: { pid?: number } | null;
        };
        pid = model.agentProcess?.pid ?? null;
        await generateText({
          model: provider.languageModel(),
          prompt: "Reply with only: OK",
          tools: provider.tools,
        });
      } finally {
        provider.cleanup();
      }
      await Bun.sleep(500);
      if (pid != null) {
        let alive = true;
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
        expect(alive).toBe(false);
      }
      const after = await countOpenCodeAcpProcesses();
      expect(after).toBeLessThanOrEqual(before);
    },
    { timeout: 180_000 },
  );
});
