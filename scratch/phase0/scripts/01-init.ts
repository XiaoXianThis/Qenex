/**
 * Phase 0.1 — peer / import / initSession smoke
 */
import {
  assert,
  createOpenCodeProvider,
  logSection,
  OPENCODE_BIN,
  WORKSPACE,
} from "../src/shared.ts";

logSection("0.1 Peer + initSession");

assert(Bun.which("opencode") || OPENCODE_BIN, "opencode must be on PATH");
console.log("opencode:", OPENCODE_BIN);
console.log("workspace:", WORKSPACE);

const aiPkg = await import("ai");
const providerPkg = await import("@mcpc-tech/acp-ai-provider");
console.log("ai exports ok:", typeof aiPkg.streamText, typeof aiPkg.generateText);
console.log("provider exports ok:", typeof providerPkg.createACPProvider);

const provider = createOpenCodeProvider({ persistSession: true });
try {
  const session = await provider.initSession();
  console.log("sessionId:", session.sessionId);
  console.log(
    "modes:",
    session.modes?.availableModes?.map((m) => m.id) ?? "(none)",
  );
  console.log(
    "models:",
    session.models?.availableModels?.map((m) => m.modelId).slice(0, 8) ??
      "(none)",
  );
  assert(session.sessionId, "initSession must return sessionId");
  console.log("PASS 0.1");
} finally {
  provider.cleanup();
}
