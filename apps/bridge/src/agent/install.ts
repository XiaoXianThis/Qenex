/**
 * Install / uninstall ACP agents into ~/.qenex/agents.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  agentVersionDir,
  ensureQenexDirs,
} from "./paths.ts";
import {
  getInstalled,
  listInstalled,
  removeInstalled,
  upsertInstalled,
} from "./installed-db.ts";
import {
  findRegistryAgent,
  resolveInstallPlan,
} from "./registry.ts";
import {
  commandIsLaunchable,
  rebuildManagedPackageCommand,
} from "./detect.ts";
import type {
  InstalledAgentInfo,
  ProgressEmit,
} from "./types.ts";

export { listInstalled, getInstalled };

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function stage(emit: ProgressEmit | undefined, stageName: string, message: string) {
  emit?.({ type: "stage", stage: stageName, message });
}

async function runCapture(
  cmd: string[],
  cwd: string,
): Promise<{ code: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env as Record<string, string>,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export async function installAgentWithProgress(
  agentId: string,
  emit?: ProgressEmit,
): Promise<InstalledAgentInfo> {
  const id = agentId.trim();
  if (!id) throw new Error("agentId is required");

  stage(emit, "resolve", `Looking up '${id}' in ACP registry…`);
  const agent = await findRegistryAgent(id, false);
  if (!agent) {
    throw new Error(`Agent '${id}' not found in ACP registry`);
  }

  stage(emit, "plan", `Resolving install plan for ${agent.name}…`);
  const plan = resolveInstallPlan(agent);
  ensureQenexDirs();
  const installPath = agentVersionDir(id, agent.version);
  mkdirSync(installPath, { recursive: true });

  let command: string[];
  let env: Record<string, string> = {};

  if (plan.kind === "npx" && plan.package) {
    const pkg = plan.package.package;
    const args = plan.package.args ?? [];
    env = { ...(plan.package.env ?? {}) };
    stage(emit, "download", `Installing npm package ${pkg}…`);
    const bun = Bun.which("bun") ?? "bun";
    // Fresh package.json + bun add
    const pkgJson = join(installPath, "package.json");
    if (!existsSync(pkgJson)) {
      await Bun.write(
        pkgJson,
        JSON.stringify({ name: `qenex-agent-${id}`, private: true }, null, 2),
      );
    }
    const result = await runCapture([bun, "add", pkg], installPath);
    if (result.code !== 0) {
      throw new Error(
        `bun add ${pkg} failed: ${result.stderr || result.stdout || result.code}`,
      );
    }
    stage(emit, "finalize", "Resolving package entrypoint…");
    const rebuilt = rebuildManagedPackageCommand(installPath, pkg, args);
    if (!rebuilt || !commandIsLaunchable(rebuilt)) {
      throw new Error(`Installed package but could not resolve launch command for ${pkg}`);
    }
    command = rebuilt;
  } else if (plan.kind === "uvx" && plan.package) {
    const pkg = plan.package.package;
    const args = plan.package.args ?? [];
    env = { ...(plan.package.env ?? {}) };
    stage(emit, "download", `Installing Python package ${pkg} via uv…`);
    const uv = Bun.which("uv") ?? Bun.which("uvx");
    if (!uv) {
      throw new Error("uv/uvx not found on PATH; install uv to use this agent");
    }
    const toolDir = join(installPath, "tool");
    mkdirSync(toolDir, { recursive: true });
    const result = await runCapture(
      [uv === "uvx" || uv.endsWith("uvx") ? uv : "uv", "tool", "install", "--force", pkg],
      installPath,
    );
    // uv tool install puts bins on user path; also try uvx package as command
    if (result.code !== 0) {
      // Fallback: record uvx invocation
      console.warn("[agent-install] uv tool install failed:", result.stderr);
    }
    const binName = pkg.split("/").pop()?.split("@")[0] ?? pkg;
    const which = Bun.which(binName);
    if (which) {
      command = [which, ...args];
    } else {
      command = ["uvx", pkg, ...args];
    }
    if (!commandIsLaunchable(command)) {
      throw new Error(`uvx install did not produce a launchable command for ${pkg}`);
    }
  } else if (plan.kind === "binary" && plan.binary) {
    throw new Error(
      `Binary install for '${id}' is not yet supported in the Bun bridge; install the CLI manually or use an npx/uvx distribution.`,
    );
  } else {
    throw new Error(`Unsupported install plan for '${id}'`);
  }

  stage(emit, "save", "Saving install metadata…");
  const info: InstalledAgentInfo = {
    agentId: id,
    name: agent.name,
    version: agent.version,
    kind: plan.kind,
    command,
    env,
    installPath,
    installedAt: nowSecs(),
  };
  upsertInstalled(info);
  stage(emit, "ready", `${agent.name} installed`);
  return info;
}

export async function installAgent(agentId: string): Promise<InstalledAgentInfo> {
  return installAgentWithProgress(agentId);
}

export function uninstallAgent(agentId: string): InstalledAgentInfo {
  const id = agentId.trim();
  const prev = removeInstalled(id);
  if (!prev) {
    throw new Error(`Agent '${id}' is not installed`);
  }
  try {
    if (prev.installPath && existsSync(prev.installPath)) {
      rmSync(prev.installPath, { recursive: true, force: true });
    }
  } catch {
    /* best-effort cleanup */
  }
  return prev;
}
