/**
 * Phase 0.4b — force ACP requestPermission by writing OUTSIDE workspace cwd
 */
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { streamText } from "ai";
import {
  assert,
  collectFullStream,
  createOpenCodeProvider,
  emptyCensus,
  installPermissionProbe,
  logSection,
  type PermissionRequestLog,
} from "../src/shared.ts";

logSection("0.4b Outside-cwd write → permission?");

const outsideFile = join(tmpdir(), `qenex-spike-outside-${Date.now()}.txt`);
const marker = `outside-${Date.now()}`;
if (existsSync(outsideFile)) unlinkSync(outsideFile);

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
    prompt: [
      `Create a text file at this absolute path (NOT inside the project): ${outsideFile}`,
      `Write exactly: ${marker}`,
      "If you need permission, request it. Then confirm in one sentence.",
    ].join(" "),
    tools: provider.tools,
    includeRawChunks: true,
  });

  const { text, census } = await collectFullStream(
    result.fullStream as AsyncIterable<{ type: string; [k: string]: unknown }>,
    emptyCensus(),
  );

  const fileOk =
    existsSync(outsideFile) && readFileSync(outsideFile, "utf8").includes(marker);

  const report = {
    text,
    permissionCount: permissionLog.length,
    permissionSample: permissionLog[0] ?? null,
    toolCalls: census.toolCalls,
    partTypes: census.partTypes,
    fileOk,
    outsideFile,
  };
  console.log(JSON.stringify(report, null, 2));
  await Bun.write(
    new URL("../artifacts/phase0-permission-outside.json", import.meta.url),
    JSON.stringify({ ...report, permissionLog, at: new Date().toISOString() }, null, 2),
  );

  // This script documents behavior; pass if we got a conclusive observation
  assert(
    permissionLog.length > 0 || census.toolCalls > 0 || text.trim().length > 0,
    "expected some agent activity",
  );
  console.log(
    permissionLog.length > 0
      ? "PASS 0.4b — requestPermission WAS invoked"
      : "PASS 0.4b — requestPermission NOT invoked (OpenCode may auto-allow without ACP permission RPC)",
  );
} finally {
  provider.cleanup();
  if (existsSync(outsideFile)) {
    try {
      unlinkSync(outsideFile);
    } catch {
      /* ignore */
    }
  }
}
