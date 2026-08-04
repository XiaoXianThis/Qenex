import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "vscode";
import { homedir } from "node:os";

/**
 * Spawns Bun Bridge — same contract as Desktop bridge.rs / JetBrains BridgeProcessManager (M9).
 */
export class BridgeManager {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private startPromise: Promise<string> | null = null;

  constructor(private readonly context: ExtensionContext) {}

  get baseUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}` : null;
  }

  async start(cspSource: string): Promise<string> {
    if (this.port) {
      return `http://127.0.0.1:${this.port}`;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.doStart(cspSource);
    try {
      return await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const child = this.process;
    this.process = null;
    this.port = null;
    this.startPromise = null;

    if (child?.pid) {
      await killProcessTree(child.pid);
    }
  }

  private async doStart(cspSource: string): Promise<string> {
    const port = await findFreePort();
    const pathEnv = augmentedPath();
    const bun = findBun(pathEnv);
    const entry = await resolveBridgeEntry(this.context.extensionPath);
    const bridgeCwd = path.dirname(path.dirname(entry)); // …/bridge/src → …/bridge

    const cors = [
      cspSource,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ]
      .filter(Boolean)
      .join(",");

    console.log(
      `[qenex] starting Bun Bridge: bun=${bun} entry=${entry} port=${port}`,
    );

    const child = spawn(bun, [entry], {
      cwd: bridgeCwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PATH: pathEnv,
        HOME: process.env.HOME ?? process.env.USERPROFILE,
        QENEX_BRIDGE_HOST: "127.0.0.1",
        QENEX_BRIDGE_PORT: String(port),
        QENEX_CORS_ORIGINS: cors,
      },
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      console.log("[qenex-bridge]", chunk.toString().trimEnd());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      console.error("[qenex-bridge]", chunk.toString().trimEnd());
    });
    child.on("error", (error) => {
      console.error("[qenex-bridge] process error:", error);
    });

    let exitedEarly: Error | null = null;
    child.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        exitedEarly = new Error(
          `Bridge exited with code ${code}${signal ? ` (signal ${signal})` : ""}`,
        );
      }
    });

    this.process = child;
    await waitForHealth(port, 30_000, () => exitedEarly);
    this.port = port;
    return `http://127.0.0.1:${port}`;
  }
}

function findBun(pathEnv: string): string {
  const override = process.env.QENEX_BUN_BIN?.trim();
  if (override) {
    if (existsSync(override) || whichInPath(override, pathEnv)) {
      return override;
    }
    throw new Error(`QENEX_BUN_BIN not found: ${override}`);
  }
  const fromPath = whichInPath("bun", pathEnv);
  if (fromPath) return fromPath;
  const homeBun = path.join(homedir(), ".bun", "bin", "bun");
  if (existsSync(homeBun)) return homeBun;
  throw new Error(
    "Bun not found on PATH. Install Bun (https://bun.sh) or set QENEX_BUN_BIN.",
  );
}

function whichInPath(name: string, pathEnv: string): string | null {
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    if (!dir.trim()) continue;
    const candidate = path.join(dir.trim(), name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function resolveBridgeEntry(extensionPath: string): Promise<string> {
  const override = process.env.QENEX_BRIDGE_ENTRY?.trim();
  if (override) {
    await access(override);
    return path.resolve(override);
  }

  // Dev first: monorepo apps/bridge (workspace-resolvable deps)
  const dev = path.resolve(extensionPath, "../bridge/src/index.ts");
  if (existsSync(dev)) {
    return dev;
  }
  const fromRepo = path.resolve(extensionPath, "../../apps/bridge/src/index.ts");
  if (existsSync(fromRepo)) {
    return fromRepo;
  }

  const packaged = path.join(extensionPath, "bridge", "src", "index.ts");
  const packagedRoot = path.join(extensionPath, "bridge");
  if (existsSync(packaged)) {
    const ai = path.join(packagedRoot, "node_modules", "ai", "package.json");
    if (!existsSync(ai)) {
      // Best-effort local install for incomplete stage
      const bun = findBun(augmentedPath());
      const install = spawnSync(bun, ["install", "--production"], {
        cwd: packagedRoot,
        encoding: "utf8",
      });
      if (install.status !== 0 || !existsSync(ai)) {
        throw new Error(
          `Packaged bridge at ${packagedRoot} missing node_modules/ai` +
            (install.stderr ? `\n${install.stderr}` : ""),
        );
      }
    }
    return packaged;
  }

  throw new Error(
    `Bun Bridge entry not found (tried ${packaged}). Set QENEX_BRIDGE_ENTRY or bundle bridge/ into the extension.`,
  );
}

function augmentedPath(): string {
  const sep = process.platform === "win32" ? ";" : ":";
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null) => {
    if (!raw) return;
    for (const p of raw.split(sep)) {
      const t = p.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        parts.push(t);
      }
    }
  };

  if (process.platform !== "win32") {
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const r = spawnSync(shell, ["-l", "-c", 'printf %s "$PATH"'], {
        encoding: "utf8",
        timeout: 5000,
      });
      if (r.status === 0) push(r.stdout);
    } catch {
      /* ignore */
    }
  }
  push(process.env.PATH);
  const home = homedir();
  for (const rel of [
    ".bun/bin",
    ".local/bin",
    ".cargo/bin",
    ".deno/bin",
    "bin",
    ".nvm/current/bin",
  ]) {
    push(path.join(home, rel));
  }
  if (process.platform !== "win32") {
    push(
      [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ].join(sep),
    );
  }
  return parts.join(sep);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealth(
  port: number,
  timeoutMs: number,
  getExitError: () => Error | null,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/health`;

  while (Date.now() < deadline) {
    const exitError = getExitError();
    if (exitError) throw exitError;

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // starting
    }
    await sleep(250);
  }

  const exitError = getExitError();
  if (exitError) throw exitError;
  throw new Error(
    `Bridge failed to become healthy on port ${port} within ${timeoutMs}ms`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already exited
    }
    resolve();
  });
}
