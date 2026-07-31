/**
 * Phase 0.2 — single-turn streaming text
 */
import { streamText } from "ai";
import {
  assert,
  collectFullStream,
  createOpenCodeProvider,
  emptyCensus,
  logSection,
} from "../src/shared.ts";

logSection("0.2 Single-turn streamText");

const provider = createOpenCodeProvider({ persistSession: true });
try {
  const session = await provider.initSession();
  console.log("sessionId:", session.sessionId);

  const result = streamText({
    model: provider.languageModel(),
    prompt:
      "Reply with exactly one short English sentence that includes the word PONG. No tools.",
    tools: provider.tools,
    includeRawChunks: true,
  });

  const { text, census } = await collectFullStream(
    result.fullStream as AsyncIterable<{ type: string; [k: string]: unknown }>,
    emptyCensus(),
  );

  console.log("text:", text);
  console.log("census:", JSON.stringify(census, null, 2));

  assert(text.trim().length > 0, "expected non-empty streamed text");
  assert(/pong/i.test(text), `expected PONG in reply, got: ${text}`);
  assert(census.textChunks > 0 || census.textChars > 0, "expected text deltas");
  console.log("PASS 0.2");
} finally {
  provider.cleanup();
}
