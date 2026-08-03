import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureQenexDirs, installedDbPath } from "./paths.ts";
import type { InstalledAgentInfo } from "./types.ts";

type InstalledDb = {
  agents: Record<string, InstalledAgentInfo>;
};

function readDb(): InstalledDb {
  const path = installedDbPath();
  if (!existsSync(path)) return { agents: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      agents?: Record<string, InstalledAgentInfo>;
    };
    return { agents: raw.agents ?? {} };
  } catch {
    return { agents: {} };
  }
}

function writeDb(db: InstalledDb): void {
  ensureQenexDirs();
  writeFileSync(installedDbPath(), `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

export function listInstalled(): InstalledAgentInfo[] {
  const agents = Object.values(readDb().agents);
  agents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return agents;
}

export function getInstalled(agentId: string): InstalledAgentInfo | null {
  return readDb().agents[agentId] ?? null;
}

export function upsertInstalled(agent: InstalledAgentInfo): void {
  const db = readDb();
  db.agents[agent.agentId] = agent;
  writeDb(db);
}

export function removeInstalled(agentId: string): InstalledAgentInfo | null {
  const db = readDb();
  const prev = db.agents[agentId] ?? null;
  if (!prev) return null;
  delete db.agents[agentId];
  writeDb(db);
  return prev;
}
