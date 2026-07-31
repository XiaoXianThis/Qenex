/**
 * Phase 0.4 — tools / permission / raw stream parts
 *
 * Documents how ACP requestPermission surfaces (or does not) in AI SDK streams.
 */
import { unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { streamText } from "ai";
import {
  assert,
  collectFullStream,
  createOpenCodeProvider,
  emptyCensus,
  installPermissionProbe,
  logSection,
  WORKSPACE,
  type PermissionRequestLog,
} from "../src/shared.ts";

logSection("0.4 Tools + permission probe + raw parts");

const targetFile = join(WORKSPACE, "spike-write.txt");
const marker = `spike-ok-${Date.now()}`;
if (existsSync(targetFile)) unlinkSync(targetFile);

const permissionLog: PermissionRequestLog[] = [];
const provider = createOpenCodeProvider({
  persistSession: true,
  env: { ACP_AI_PROVIDER_DEBUG: "1" },
});

try {
  const session = await provider.initSession();
  console.log("sessionId:", session.sessionId);
  if (session.modes?.availableModes?.length) {
    console.log(
      "available modes:",
      session.modes.availableModes.map((m) => `${m.id}`).join(", "),
      "| current:",
      session.modes.currentModeId,
    );
    // Prefer a mode that still asks for permission if available
    const askLike = session.modes.availableModes.find((m) =>
      /ask|default|edit/i.test(m.id),
    );
    if (askLike && askLike.id !== session.modes.currentModeId) {
      try {
        await provider.setMode(askLike.id);
        console.log("setMode →", askLike.id);
      } catch (e) {
        console.warn("setMode skipped:", e);
      }
    }
  }

  installPermissionProbe(provider, permissionLog, "allow-first");
  console.log("permission probe installed (allow-first)");

  const result = streamText({
    model: provider.languageModel(),
    prompt: [
      "Use tools to create a file at spike-write.txt in the current workspace.",
      `Write exactly this content (no quotes): ${marker}`,
      "Then briefly confirm done in one sentence.",
    ].join(" "),
    tools: provider.tools,
    includeRawChunks: true,
  });

  const { text, census } = await collectFullStream(
    result.fullStream as AsyncIterable<{ type: string; [k: string]: unknown }>,
    emptyCensus(),
  );

  console.log("assistant text:", text);
  console.log("partTypes:", census.partTypes);
  console.log("toolCalls:", census.toolCalls, "toolResults:", census.toolResults);
  console.log("rawParts count:", census.rawParts.length);
  if (census.rawParts.length) {
    console.log("rawParts sample:", JSON.stringify(census.rawParts.slice(0, 3), null, 2));
  }
  console.log("permission requests:", permissionLog.length);
  if (permissionLog.length) {
    console.log(
      "permission sample:",
      JSON.stringify(permissionLog[0], null, 2).slice(0, 2000),
    );
  }

  const fileExists = existsSync(targetFile);
  const fileBody = fileExists ? readFileSync(targetFile, "utf8") : "";
  console.log("file exists:", fileExists, "content:", JSON.stringify(fileBody));

  // Soft requirements: at least one of tool stream / permission / file write must prove agent acted
  const acted =
    census.toolCalls > 0 ||
    permissionLog.length > 0 ||
    (fileExists && fileBody.includes(marker));

  assert(acted, "expected tool activity, permission request, and/or file write");
  assert(text.trim().length > 0, "expected some assistant text after tool use");

  // Document findings for Spike 结论
  const findings = {
    permissionInStream: false, // AI SDK stream has no approval-requested from provider
    permissionViaAcpCallback: permissionLog.length > 0,
    permissionDefaultBehavior:
      "acp-ai-provider auto-selects options[0] unless setPermissionRequestHandler is hooked (private client API)",
    toolCallsInStream: census.toolCalls > 0,
    rawPartsInStream: census.rawParts.length > 0,
    rawPartTypes: [
      ...new Set(
        census.rawParts.map((p) =>
          p && typeof p === "object" && "type" in p
            ? String((p as { type: unknown }).type)
            : typeof p,
        ),
      ),
    ],
    fileWritten: fileExists && fileBody.includes(marker),
    partTypes: census.partTypes,
    permissionCount: permissionLog.length,
  };
  console.log("FINDINGS:", JSON.stringify(findings, null, 2));

  await Bun.write(
    new URL("../artifacts/phase0-permission-findings.json", import.meta.url),
    JSON.stringify(
      { findings, permissionLog, census, text, at: new Date().toISOString() },
      null,
      2,
    ),
  );

  console.log("PASS 0.4");
} finally {
  provider.cleanup();
}
