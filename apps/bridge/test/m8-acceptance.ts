/**
 * Live M8 acceptance: packaged Bun Bridge start path + health.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type Subprocess } from "bun";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

async function waitHealth(baseUrl: string, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      last = await res.text();
      if (res.ok) return JSON.parse(last) as Record<string, unknown>;
    } catch (err) {
      last = String(err);
    }
    await Bun.sleep(250);
  }
  throw new Error(`health timeout: ${last}`);
}

let child: Subprocess | null = null;

try {
  // Structural gates (also covered by unit guards)
  for (const gone of [
    "crates/bridge",
    "Cargo.toml",
    "acp-to-agui",
    "scripts/dev-rust.mjs",
    "scripts/build-rust.mjs",
  ]) {
    if (existsSync(resolve(repoRoot, gone))) {
      throw new Error(`expected deleted: ${gone}`);
    }
  }
  console.log("[m8] rust bridge paths absent OK");

  console.log("[m8] running bun run build (Bun server package)...");
  const build = spawn({
    cmd: ["bun", "run", "build"],
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const buildCode = await build.exited;
  if (buildCode !== 0) {
    throw new Error(`bun run build failed: ${buildCode}`);
  }

  const bridgeEntry = join(repoRoot, "build", "bridge", "src", "index.ts");
  if (!existsSync(bridgeEntry)) {
    throw new Error(`missing ${bridgeEntry}`);
  }

  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });
  const port = probe.port;
  if (!port) throw new Error("no free port");
  await probe.stop(true);
  const baseUrl = `http://127.0.0.1:${port}`;

  child = spawn({
    cmd: ["bun", bridgeEntry],
    cwd: join(repoRoot, "build", "bridge"),
    env: {
      ...process.env,
      QENEX_BRIDGE_HOST: "127.0.0.1",
      QENEX_BRIDGE_PORT: String(port),
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const health = await waitHealth(baseUrl);
  if (!health.ok) {
    throw new Error(`health not ok: ${JSON.stringify(health)}`);
  }
  console.log("[m8] packaged Bun Bridge health OK", health.agent);

  // No AG-UI surface on packaged bridge
  const agui = await fetch(`${baseUrl}/ag-ui`);
  if (agui.status !== 404) {
    // may be 404 JSON from our notFound — either way must not be AG-UI SSE
    const text = await agui.text();
    if (/ag-ui|event:|Agent/i.test(text) && agui.ok) {
      throw new Error(`/ag-ui still served: ${agui.status} ${text.slice(0, 200)}`);
    }
  }
  console.log("[m8] /ag-ui not a live AG-UI endpoint OK");

  console.log("M8_ACCEPTANCE_OK");
} catch (err) {
  console.error("[m8] FAILED", err);
  process.exitCode = 1;
} finally {
  if (child) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}
