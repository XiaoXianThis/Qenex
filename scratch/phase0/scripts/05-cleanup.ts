/**
 * Phase 0.5 — cleanup leaves no opencode acp zombies
 */
import {
  assert,
  countOpenCodeAcpProcesses,
  createOpenCodeProvider,
  logSection,
} from "../src/shared.ts";
import { generateText } from "ai";

logSection("0.5 cleanup / no zombies");

const before = await countOpenCodeAcpProcesses();
console.log("opencode acp processes before:", before);

const provider = createOpenCodeProvider({ persistSession: true });
let childPid: number | null = null;

try {
  await provider.initSession();
  const model = provider.languageModel() as unknown as {
    agentProcess?: { pid?: number } | null;
  };
  childPid = model.agentProcess?.pid ?? null;
  console.log("agent pid:", childPid);

  await generateText({
    model: provider.languageModel(),
    prompt: "Reply with only: OK",
    tools: provider.tools,
  });

  const during = await countOpenCodeAcpProcesses();
  console.log("opencode acp processes during:", during);
  assert(during >= before, "expected agent process while session alive");
} finally {
  provider.cleanup();
}

// Give the OS a moment to reap
await Bun.sleep(500);

const after = await countOpenCodeAcpProcesses();
console.log("opencode acp processes after cleanup:", after);

if (childPid != null) {
  const stillAlive = (() => {
    try {
      // signal 0 = existence check
      process.kill(childPid!, 0);
      return true;
    } catch {
      return false;
    }
  })();
  console.log("specific agent pid still alive:", stillAlive);
  assert(!stillAlive, `agent pid ${childPid} still alive after cleanup()`);
}

// Allow unrelated leftover processes from other tools, but our count should not grow
assert(
  after <= before,
  `cleanup leaked processes: before=${before} after=${after}`,
);

console.log("PASS 0.5");
