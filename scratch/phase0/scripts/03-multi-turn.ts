/**
 * Phase 0.3 — multi-turn persistSession memory
 */
import { generateText } from "ai";
import {
  assert,
  createOpenCodeProvider,
  logSection,
} from "../src/shared.ts";

logSection("0.3 Multi-turn session memory");

const SECRET = `QX-SPIKE-${Date.now().toString(36).toUpperCase()}`;
const provider = createOpenCodeProvider({ persistSession: true });

try {
  const session = await provider.initSession();
  console.log("sessionId:", session.sessionId);
  console.log("secret:", SECRET);

  const turn1 = await generateText({
    model: provider.languageModel(),
    prompt: `Remember this secret code exactly: ${SECRET}. Reply with only: ACK`,
    tools: provider.tools,
  });
  console.log("turn1:", turn1.text);

  const turn2 = await generateText({
    model: provider.languageModel(),
    prompt:
      "What was the secret code I just asked you to remember? Reply with the code only, nothing else.",
    tools: provider.tools,
  });
  console.log("turn2:", turn2.text);

  assert(
    turn2.text.includes(SECRET),
    `second turn must recall secret ${SECRET}, got: ${turn2.text}`,
  );
  console.log("PASS 0.3");
} finally {
  provider.cleanup();
}
