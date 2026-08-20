/**
 * Detect local ACP agents and resolve launch commands.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BridgeError } from "../errors.ts";
import { agentsDir, resolveBunExecutable } from "./paths.ts";
import { getInstalled } from "./installed-db.ts";
import { preferredKindFor } from "./registry.ts";
import { compatGradeFor } from "./compat/grades.ts";
import type {
  AgentDetectedSource,
  AgentDistributionClass,
  AgentReadiness,
  AgentStatus,
  DiscoveredAgentEntry,
  RegistryAgentRaw,
  ResolvedLaunch,
} from "./types.ts";

type NativeProfile = {
  id: string;
  bin: string;
  pathBins: string[];
  argv: string[];
};

type AdapterProfile = {
  id: string;
  package: string;
  pathBins: string[];
  hostBins: string[];
};

const NATIVES: NativeProfile[] = [
  {
    id: "opencode",
    bin: "opencode",
    pathBins: ["opencode"],
    argv: ["opencode", "acp"],
  },
  {
    id: "kiro",
    bin: "kiro-cli",
    pathBins: ["kiro-cli"],
    argv: ["kiro-cli", "acp"],
  },
  {
    id: "cursor-agent",
    bin: "cursor-agent",
    pathBins: ["cursor-agent", "agent"],
    argv: ["cursor-agent", "acp"],
  },
  {
    id: "gemini",
    bin: "gemini",
    pathBins: ["gemini"],
    argv: ["gemini", "--experimental-acp"],
  },
  {
    id: "qoder",
    bin: "qodercli",
    pathBins: ["qodercli", "qoder"],
    argv: ["qodercli", "--acp"],
  },
];

const ADAPTERS: AdapterProfile[] = [
  {
    id: "claude-acp",
    package: "@agentclientprotocol/claude-agent-acp",
    pathBins: ["claude-agent-acp"],
    hostBins: ["claude"],
  },
  {
    id: "codex-acp",
    package: "@agentclientprotocol/codex-acp",
    pathBins: ["codex-acp"],
    hostBins: ["codex"],
  },
  {
    id: "pi-acp",
    package: "pi-acp",
    pathBins: ["pi-acp"],
    hostBins: ["pi"],
  },
];

export function canonicalAgentId(id: string): string {
  switch (id.trim()) {
    case "claude":
      return "claude-acp";
    case "codex":
      return "codex-acp";
    case "cursor":
      return "cursor-agent";
    case "pi":
      return "pi-acp";
    case "qodercli":
      return "qoder";
    default:
      return id.trim();
  }
}

function envNonempty(key: string): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0;
}

function homeFile(...parts: string[]): boolean {
  try {
    return existsSync(join(homedir(), ...parts));
  } catch {
    return false;
  }
}

export function authHintFor(agentId: string): string | null {
  const id = canonicalAgentId(agentId);
  if (id === "claude-acp") {
    if (
      envNonempty("ANTHROPIC_API_KEY") ||
      homeFile(".claude", "credentials.json") ||
      homeFile(".claude.json") ||
      homeFile(".config", "claude")
    ) {
      return null;
    }
    return "Claude 可能需要登录或设置 ANTHROPIC_API_KEY 后才能对话";
  }
  if (id === "codex-acp") {
    if (
      envNonempty("OPENAI_API_KEY") ||
      envNonempty("CODEX_API_KEY") ||
      homeFile(".codex", "auth.json") ||
      homeFile(".codex", "config.toml")
    ) {
      return null;
    }
    return "Codex 可能需要登录或设置 OPENAI_API_KEY / CODEX_API_KEY 后才能对话";
  }
  if (id === "cursor-agent") {
    if (
      envNonempty("CURSOR_API_KEY") ||
      envNonempty("CURSOR_AUTH_TOKEN") ||
      homeFile(".cursor", "cli-config.json") ||
      homeFile(".cursor", "auth.json")
    ) {
      return null;
    }
    return "Cursor 需要先执行 `agent login`（或设置 CURSOR_API_KEY）后再创建会话";
  }
  if (id === "pi-acp") {
    if (
      envNonempty("ANTHROPIC_API_KEY") ||
      envNonempty("OPENAI_API_KEY") ||
      homeFile(".pi") ||
      homeFile(".config", "pi")
    ) {
      return null;
    }
    return "pi ACP 可能需要本机已登录的 pi CLI 或 API Key";
  }
  if (id === "qoder") {
    if (homeFile(".qoder") || homeFile(".qodercli")) {
      return null;
    }
    return "Qoder 需要先执行 `qodercli-login` 后再创建会话";
  }
  return null;
}

export function whichBin(name: string): string | null {
  if (!name.trim()) return null;
  if (name.includes("/") || name.includes("\\")) {
    return existsSync(name) ? name : null;
  }
  const found = Bun.which(name);
  return found ?? null;
}

export function commandIsLaunchable(command: string[]): boolean {
  if (!command.length || command.some((p) => !p?.trim())) return false;
  const first = command[0]!;
  return whichBin(first) != null || existsSync(first);
}

function scrapeVersionDirs(agentId: string): string[] {
  const root = join(agentsDir(), agentId);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root)
      .map((name) => join(root, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function findPackageEntry(installPath: string, pkg: string): string | null {
  const bare = pkg.replace(/@[^@]*$/, "").replace(/^@/, "");
  // Prefer well-known dist entries
  const candidates = [
    join(installPath, "node_modules", pkg.split("@")[0] === "" ? pkg : pkg.replace(/@[\d.]+$/, ""), "dist", "index.js"),
  ];
  // Resolve package name without version suffix
  const name = pkg.includes("@") && !pkg.startsWith("@")
    ? pkg.split("@")[0]!
    : pkg.replace(/@[\d.]+$/, "");
  const scoped = name.startsWith("@") ? name : null;
  if (scoped) {
    candidates.push(
      join(installPath, "node_modules", scoped, "dist", "index.js"),
      join(installPath, "node_modules", scoped, "bundle", `${scoped.split("/")[1]}.js`),
    );
  } else {
    candidates.push(
      join(installPath, "node_modules", name, "dist", "index.js"),
      join(installPath, "node_modules", name, "bundle", `${name}.js`),
    );
  }
  // Walk package path from npm-style @scope/name@version → @scope/name
  const nm = join(installPath, "node_modules");
  if (existsSync(nm)) {
    try {
      const walk = (dir: string, depth: number): string | null => {
        if (depth > 4) return null;
        for (const ent of readdirSync(dir)) {
          const p = join(dir, ent);
          try {
            if (!statSync(p).isDirectory()) continue;
          } catch {
            continue;
          }
          for (const rel of [
            "dist/index.js",
            "bundle/index.js",
            `bundle/${ent}.js`,
          ]) {
            const hit = join(p, rel);
            if (existsSync(hit)) return hit;
          }
          if (ent.startsWith("@")) {
            const nested = walk(p, depth + 1);
            if (nested) return nested;
          }
        }
        return null;
      };
      // Prefer matching package folder
      const pkgDir = scoped
        ? join(nm, scoped)
        : join(nm, name);
      if (existsSync(pkgDir)) {
        for (const rel of ["dist/index.js", "bundle/index.js"]) {
          const hit = join(pkgDir, rel);
          if (existsSync(hit)) return hit;
        }
        // qoder/gemini style
        try {
          for (const ent of readdirSync(join(pkgDir, "bundle"))) {
            if (ent.endsWith(".js")) return join(pkgDir, "bundle", ent);
          }
        } catch {
          /* ignore */
        }
      }
      void bare;
      return walk(nm, 0);
    } catch {
      /* ignore */
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function rebuildManagedPackageCommand(
  installPath: string,
  pkg: string,
  args: string[] = [],
): string[] | null {
  if (!existsSync(installPath)) return null;
  const entry = findPackageEntry(installPath, pkg);
  if (!entry) return null;
  const bun = resolveBunExecutable();
  return [bun, entry, ...args];
}

function managedFromDisk(
  agentId: string,
  pkg: string,
  args: string[],
): string[] | null {
  const rec = getInstalled(agentId);
  if (rec) {
    if (pkg) {
      const rebuilt = rebuildManagedPackageCommand(rec.installPath, pkg, args);
      if (rebuilt && commandIsLaunchable(rebuilt)) return rebuilt;
    }
    if (commandIsLaunchable(rec.command)) return [...rec.command];
  }
  if (pkg) {
    for (const dir of scrapeVersionDirs(agentId)) {
      const rebuilt = rebuildManagedPackageCommand(dir, pkg, args);
      if (rebuilt && commandIsLaunchable(rebuilt)) return rebuilt;
    }
  }
  return null;
}

function nativePathCommand(profile: NativeProfile): string[] | null {
  for (const name of profile.pathBins) {
    if (whichBin(name)) {
      const cmd = [...profile.argv];
      cmd[0] = name;
      if (commandIsLaunchable(cmd)) return cmd;
    }
  }
  if (!whichBin(profile.bin)) return null;
  const cmd = [...profile.argv];
  return commandIsLaunchable(cmd) ? cmd : null;
}

function pathAdapterCommand(profile: AdapterProfile): string[] | null {
  for (const name of profile.pathBins) {
    const resolved = whichBin(name);
    if (resolved) {
      const cmd = [resolved];
      if (commandIsLaunchable(cmd)) return cmd;
    }
  }
  return null;
}

function hostCliAvailable(profile: AdapterProfile): boolean {
  return profile.hostBins.some((b) => whichBin(b) != null);
}

export function resolveKnownAgent(
  agentId: string,
): { command: string[]; source: AgentDetectedSource } | null {
  const id = canonicalAgentId(agentId);

  const native = NATIVES.find((n) => n.id === id);
  if (native) {
    if (id === "opencode") {
      const override = process.env.QENEX_OPENCODE_BIN?.trim();
      if (override) {
        const resolved =
          override.includes("/") || override.includes("\\")
            ? existsSync(override)
              ? override
              : null
            : whichBin(override);
        if (!resolved) {
          return null;
        }
        return { command: [resolved, "acp"], source: "path" };
      }
    }
    const pathCmd = nativePathCommand(native);
    if (pathCmd) return { command: pathCmd, source: "path" };
    const managed = managedFromDisk(id, "", []);
    if (managed) return { command: managed, source: "managed" };
    // installed.json may still have binary command
    const rec = getInstalled(id);
    if (rec && commandIsLaunchable(rec.command)) {
      return { command: [...rec.command], source: "managed" };
    }
    return null;
  }

  const adapter = ADAPTERS.find((a) => a.id === id);
  if (adapter) {
    const pathCmd = pathAdapterCommand(adapter);
    if (pathCmd) return { command: pathCmd, source: "path" };
    const managed = managedFromDisk(id, adapter.package, []);
    if (managed) return { command: managed, source: "managed" };
    return null;
  }

  // Unknown / other registry agents: installed.json or PATH bin
  const rec = getInstalled(id);
  if (rec && commandIsLaunchable(rec.command)) {
    return { command: [...rec.command], source: "managed" };
  }
  for (const dir of scrapeVersionDirs(id)) {
    const rebuilt = rebuildManagedPackageCommand(dir, "", []);
    if (rebuilt && commandIsLaunchable(rebuilt)) {
      return { command: rebuilt, source: "managed" };
    }
    // try any dist/index.js under node_modules
    const rebuiltAny = rebuildManagedPackageCommand(dir, id, []);
    if (rebuiltAny && commandIsLaunchable(rebuiltAny)) {
      return { command: rebuiltAny, source: "managed" };
    }
  }
  if (whichBin(id)) {
    return { command: [id], source: "path" };
  }
  return null;
}

export function resolveLaunchCommand(input: {
  agentId?: string;
  agentCommand?: string[];
}): ResolvedLaunch {
  const override = input.agentCommand?.filter((p) => p.trim().length > 0);
  if (override && override.length > 0) {
    if (!commandIsLaunchable(override)) {
      throw new Error(`Launch command is not executable: ${override.join(" ")}`);
    }
    return {
      agentId: canonicalAgentId(input.agentId ?? override[0]!),
      command: override,
    };
  }
  const id = canonicalAgentId(input.agentId ?? "opencode");
  const resolved = resolveKnownAgent(id);
  if (!resolved) {
    if (id === "opencode") {
      throw new BridgeError(
        "opencode_not_found",
        "OpenCode binary not found on PATH. Install OpenCode and ensure `opencode` is available (try `opencode --version`).",
        503,
      );
    }
    throw new BridgeError(
      "agent_unavailable",
      `Agent '${id}' is not available. Install it from Registry or ensure it is on PATH.`,
      400,
    );
  }
  const rec = getInstalled(id);
  return {
    agentId: id,
    command: resolved.command,
    env: rec?.env,
  };
}

export function probeLaunchCommand(command: string[]): void {
  if (!commandIsLaunchable(command)) {
    throw new Error(`Command not launchable: ${command.join(" ")}`);
  }
}

function distributionClassFor(
  kind: AgentStatus["preferredKind"],
): AgentDistributionClass {
  if (kind === "npx" || kind === "uvx") return "adapter";
  return "native";
}

export function evaluateAgentStatus(agent: RegistryAgentRaw): AgentStatus {
  const id = canonicalAgentId(agent.id);
  const preferredKind = preferredKindFor(agent);
  const installable = preferredKind != null;
  const managed = getInstalled(id);
  let updateAvailable = false;
  if (managed && agent.version && managed.version !== agent.version) {
    updateAvailable = true;
  }

  const resolved = resolveKnownAgent(id);
  if (resolved) {
    const authHint = authHintFor(id);
    return {
      readiness: authHint ? "needAuth" : "ready",
      distributionClass: distributionClassFor(preferredKind),
      detected: resolved.source,
      resolvedCommand: resolved.command,
      updateAvailable,
      installable,
      preferredKind,
      managed,
      detail: null,
      authHint,
    };
  }

  const adapter = ADAPTERS.find((a) => a.id === id);
  if (adapter && hostCliAvailable(adapter)) {
    return {
      readiness: "needAdapter",
      distributionClass: "adapter",
      detected: "none",
      resolvedCommand: null,
      updateAvailable,
      installable,
      preferredKind,
      managed,
      detail: `Host CLI found; install the '${id}' adapter to connect`,
      authHint: null,
    };
  }

  if (installable) {
    return {
      readiness: "install",
      distributionClass: distributionClassFor(preferredKind),
      detected: "none",
      resolvedCommand: null,
      updateAvailable,
      installable,
      preferredKind,
      managed,
      detail: null,
      authHint: null,
    };
  }

  return {
    readiness: "unavailable",
    distributionClass: distributionClassFor(preferredKind),
    detected: "none",
    resolvedCommand: null,
    updateAvailable: false,
    installable: false,
    preferredKind,
    managed,
    detail: `No install plan for this platform`,
    authHint: null,
  };
}

export async function discoverLocalAgents(
  registryAgents: RegistryAgentRaw[],
): Promise<DiscoveredAgentEntry[]> {
  const out: DiscoveredAgentEntry[] = [];
  const seen = new Set<string>();

  const consider = (
    id: string,
    name: string,
    version: string,
    icon?: string | null,
  ) => {
    const cid = canonicalAgentId(id);
    if (seen.has(cid)) return;
    const resolved = resolveKnownAgent(cid);
    if (!resolved) return;
    const authHint = authHintFor(cid);
    const readiness: AgentReadiness = authHint ? "needAuth" : "ready";
    seen.add(cid);
    out.push({
      id: cid,
      name,
      version,
      readiness,
      detected: resolved.source,
      resolvedCommand: resolved.command,
      updateAvailable: false,
      detail: null,
      authHint,
      icon: icon ?? null,
      compatGrade: compatGradeFor(cid),
    });
  };

  for (const agent of registryAgents) {
    const status = evaluateAgentStatus(agent);
    if (
      status.readiness === "ready" ||
      status.readiness === "needAuth" ||
      status.readiness === "needAdapter"
    ) {
      seen.add(canonicalAgentId(agent.id));
      out.push({
        id: canonicalAgentId(agent.id),
        name: agent.name,
        version: agent.version,
        readiness: status.readiness,
        detected: status.detected,
        resolvedCommand: status.resolvedCommand,
        updateAvailable: status.updateAvailable,
        detail: status.detail,
        authHint: status.authHint,
        icon: agent.icon,
        compatGrade: compatGradeFor(agent.id),
      });
    }
  }

  for (const n of NATIVES) {
    consider(n.id, n.id, "local", null);
  }
  for (const a of ADAPTERS) {
    consider(a.id, a.id, "local", null);
  }
  const { listInstalled } = await import("./installed-db.ts");
  for (const inst of listInstalled()) {
    consider(inst.agentId, inst.name, inst.version, null);
  }

  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}
