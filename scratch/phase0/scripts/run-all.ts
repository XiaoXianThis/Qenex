/**
 * Run all Phase 0 spike scripts sequentially. Exit non-zero on first failure.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const scripts = [
  "scripts/01-init.ts",
  "scripts/02-single-turn.ts",
  "scripts/03-multi-turn.ts",
  "scripts/04-tools-permission.ts",
  "scripts/04b-permission-outside.ts",
  "scripts/05-cleanup.ts",
];

const started = Date.now();
const results: Array<{ script: string; ok: boolean; ms: number; error?: string }> =
  [];

for (const rel of scripts) {
  const path = resolve(root, rel);
  console.log(`\n\n######## RUN ${rel} ########`);
  const t0 = Date.now();
  const proc = Bun.spawn(["bun", "run", path], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      ACP_AI_PROVIDER_DEBUG: process.env.ACP_AI_PROVIDER_DEBUG ?? "1",
    },
  });
  const code = await proc.exited;
  const ms = Date.now() - t0;
  if (code !== 0) {
    results.push({ script: rel, ok: false, ms, error: `exit ${code}` });
    console.error(`\nFAILED ${rel} (${ms}ms)`);
    await Bun.write(
      resolve(root, "artifacts/phase0-run-summary.json"),
      JSON.stringify(
        { ok: false, results, totalMs: Date.now() - started, at: new Date().toISOString() },
        null,
        2,
      ),
    );
    process.exit(code);
  }
  results.push({ script: rel, ok: true, ms });
  console.log(`\nOK ${rel} (${ms}ms)`);
}

const summary = {
  ok: true,
  results,
  totalMs: Date.now() - started,
  versions: {
    ai: (await import("ai/package.json")).default?.version ?? "unknown",
    acpAiProvider: "0.3.4",
    bun: Bun.version,
  },
  at: new Date().toISOString(),
};

// Resolve package versions more reliably
try {
  const aiPkg = await Bun.file(
    resolve(root, "node_modules/ai/package.json"),
  ).json();
  const acpPkg = await Bun.file(
    resolve(root, "node_modules/@mcpc-tech/acp-ai-provider/package.json"),
  ).json();
  summary.versions.ai = aiPkg.version;
  summary.versions.acpAiProvider = acpPkg.version;
} catch {
  /* keep defaults */
}

await Bun.write(
  resolve(root, "artifacts/phase0-run-summary.json"),
  JSON.stringify(summary, null, 2),
);

console.log("\n\n======== PHASE 0 ALL PASSED ========");
console.log(JSON.stringify(summary, null, 2));
