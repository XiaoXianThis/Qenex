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
    if (this.port && this.isRunning()) {
      return `http://127.0.0.1:${this.port}`;
    }
    if (this.port && !this.isRunning()) {
      this.port = null;
      this.process = null;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.doStart(cspSource);
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private isRunning(): boolean {
    return Boolean(
      this.process &&
        this.process.exitCode === null &&
        this.process.signalCode === null,
    );
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
    const bridgeCwd = entry.endsWith(`${path.sep}index.js`)
      ? path.dirname(entry)
      : path.dirname(path.dirname(entry)); // …/bridge/src → …/bridge

    // webview.cspSource may be "'self' https://*.vscode-cdn.net" — tokenize + allow vscode-webview://
    const cors = buildCorsOrigins(cspSource, port);

    console.log(
      `[qenex] starting Bun Bridge: bun=${bun} entry=${entry} port=${port}`,
    );
    console.log(`[qenex] QENEX_CORS_ORIGINS=${cors}`);

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
    let exitedEarly: Error | null = null;
    child.on("error", (error) => {
      exitedEarly = error;
      console.error("[qenex-bridge] process error:", error);
    });
    child.on("exit", (code, signal) => {
      exitedEarly = new Error(
        `Bridge exited${code === null ? "" : ` with code ${code}`}${signal ? ` (signal ${signal})` : ""}`,
      );
      if (this.process === child) {
        this.process = null;
        this.port = null;
      }
    });

    this.process = child;
    try {
      await waitForHealth(port, 30_000, () => exitedEarly);
      if (this.process !== child || !this.isRunning()) {
        throw exitedEarly ?? new Error("Bridge exited during startup");
      }
      this.port = port;
      return `http://127.0.0.1:${port}`;
    } catch (error) {
      if (this.process === child) {
        this.process = null;
        this.port = null;
      }
      if (child.pid) await killProcessTree(child.pid);
      throw error;
    }
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
  if (process.platform === "win32") {
    const fromPathExe = whichInPath("bun.exe", pathEnv);
    if (fromPathExe) return fromPathExe;
  }
  const homeBun = path.join(
    homedir(),
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  if (existsSync(homeBun)) return homeBun;
  throw new Error(
    "Bun not found on PATH. Install Bun (https://bun.sh) or set QENEX_BUN_BIN.",
  );
}

/** Normalize VS Code cspSource into Bridge CORS allow-list entries. */
export function buildCorsOrigins(cspSource: string, port: number): string {
  const keywords = new Set([
    "'self'",
    "'none'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "self",
    "none",
  ]);
  const tokens: string[] = [];
  for (const chunk of (cspSource || "").split(/[\s,]+/)) {
    const t = chunk.trim();
    if (!t || keywords.has(t)) continue;
    tokens.push(t);
  }
  const list = [
    ...tokens,
    "vscode-webview://*",
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ];
  return [...new Set(list)].join(",");
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

  const packaged = path.join(extensionPath, "bridge", "index.js");
  if (existsSync(packaged)) {
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
      resolve();
      return;
    }
    let poll: ReturnType<typeof setInterval> | undefined;
    const deadline = setTimeout(() => {
      if (poll) clearInterval(poll);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already exited
      }
      resolve();
    }, 3_000);
    poll = setInterval(() => {
      try {
        process.kill(pid, 0);
      } catch {
        clearInterval(poll);
        clearTimeout(deadline);
        resolve();
      }
    }, 50);
  });
}
