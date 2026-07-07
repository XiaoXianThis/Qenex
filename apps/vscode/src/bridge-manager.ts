import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "vscode";

type BridgeConfigTemplate = {
  projectName: string;
  displayTitle: string;
  description: string;
  agentCommand: string[];
  backendPort: number;
  corsOrigins: string[];
};

export class BridgeManager {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private configPath: string | null = null;
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

    if (this.configPath) {
      await unlink(this.configPath).catch(() => undefined);
      this.configPath = null;
    }
  }

  private async doStart(cspSource: string): Promise<string> {
    const port = await findFreePort();
    const storageDir = this.context.globalStorageUri.fsPath;
    await mkdir(storageDir, { recursive: true });

    const configPath = path.join(storageDir, "bridge.config.json");
    const template = await loadConfigTemplate(this.context.extensionPath);
    const config: BridgeConfigTemplate = {
      ...template,
      backendPort: port,
      corsOrigins: [
        cspSource,
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    this.configPath = configPath;

    const binName =
      process.platform === "win32" ? "acp-to-agui.exe" : "acp-to-agui";
    const binPath = path.join(this.context.extensionPath, "bin", binName);

    const { access } = await import("node:fs/promises");
    try {
      await access(binPath);
    } catch {
      throw new Error(
        `Bridge binary not found at ${binPath}. Run "bun run build:vscode" first.`,
      );
    }

    const child = spawn(binPath, ["--config", configPath], {
      cwd: path.dirname(binPath),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        HOME: process.env.HOME ?? process.env.USERPROFILE,
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

async function loadConfigTemplate(
  extensionPath: string,
): Promise<BridgeConfigTemplate> {
  const configPath = path.join(extensionPath, "bridge.config.json");
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw) as BridgeConfigTemplate;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
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
    if (exitError) {
      throw exitError;
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Bridge still starting
    }
    await sleep(250);
  }

  const exitError = getExitError();
  if (exitError) {
    throw exitError;
  }

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
