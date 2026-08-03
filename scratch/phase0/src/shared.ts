/**
 * Phase 0 shared helpers — OpenCode + acp-ai-provider + AI SDK v7
 */
import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKSPACE = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../workspace",
);

/** Prefer ~/.bun/bin/opencode over accidental node_modules shims. */
export const OPENCODE_BIN = (() => {
  const bunBin = `${process.env.HOME ?? ""}/.bun/bin/opencode`;
  if (bunBin && existsSync(bunBin)) return bunBin;
  return Bun.which("opencode") ?? "opencode";
})();

export type PermissionRequestLog = {
  at: string;
  params: unknown;
};

export type StreamCensus = {
  textChars: number;
  textChunks: number;
  toolCalls: number;
  toolResults: number;
  reasoningChunks: number;
  rawParts: unknown[];
  partTypes: Record<string, number>;
  finishReason?: string;
};

function cleanEnv(
  extra?: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    ...extra,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v === "string") out[k] = v;
  }
  // Always inherit PATH so GUI-spawned shells still find opencode deps
  if (!out.PATH && process.env.PATH) out.PATH = process.env.PATH;
  return Object.keys(out).length ? out : undefined;
}

export function createOpenCodeProvider(opts?: {
  cwd?: string;
  persistSession?: boolean;
  env?: Record<string, string>;
}): ACPProvider {
  return createACPProvider({
    command: OPENCODE_BIN,
    args: ["acp"],
    session: {
      cwd: opts?.cwd ?? WORKSPACE,
      mcpServers: [],
    },
    persistSession: opts?.persistSession ?? true,
    env: cleanEnv({
      ...opts?.env,
      ACP_AI_PROVIDER_DEBUG:
        opts?.env?.ACP_AI_PROVIDER_DEBUG ?? process.env.ACP_AI_PROVIDER_DEBUG,
    }),
  });
}

/**
 * Hook ACP requestPermission via private client (spike only).
 * Public createACPProvider has no permission API — default is auto-allow first option.
 */
export function installPermissionProbe(
  provider: ACPProvider,
  log: PermissionRequestLog[],
  decide: "allow-first" | "reject" = "allow-first",
): void {
  const model = provider.languageModel() as unknown as {
    client?: {
      setPermissionRequestHandler?: (
        handler: (params: {
          options: Array<{ optionId: string; name?: string; kind?: string }>;
          toolCall?: unknown;
        }) => Promise<{
          outcome: { outcome: string; optionId?: string };
        }>,
      ) => void;
    };
  };

  const client = model.client;
  if (!client?.setPermissionRequestHandler) {
    throw new Error(
      "Permission probe unavailable: languageModel().client.setPermissionRequestHandler missing after initSession. " +
        "Call installPermissionProbe only after await provider.initSession().",
    );
  }

  client.setPermissionRequestHandler(async (params) => {
    log.push({ at: new Date().toISOString(), params });
    if (decide === "reject") {
      const reject =
        params.options.find((o) => /reject|deny|cancel|no/i.test(o.optionId)) ??
        params.options.find((o) => /reject|deny|cancel|no/i.test(o.name ?? ""));
      if (reject) {
        return { outcome: { outcome: "selected", optionId: reject.optionId } };
      }
      return { outcome: { outcome: "cancelled" } };
    }
    return {
      outcome: {
        outcome: "selected",
        optionId: params.options[0]?.optionId || "allow",
      },
    };
  });
}

export function emptyCensus(): StreamCensus {
  return {
    textChars: 0,
    textChunks: 0,
    toolCalls: 0,
    toolResults: 0,
    reasoningChunks: 0,
    rawParts: [],
    partTypes: {},
  };
}

export function notePart(census: StreamCensus, type: string): void {
  census.partTypes[type] = (census.partTypes[type] ?? 0) + 1;
}

export async function collectFullStream(
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>,
  census: StreamCensus = emptyCensus(),
): Promise<{ text: string; census: StreamCensus }> {
  let text = "";
  for await (const part of fullStream) {
    notePart(census, part.type);
    switch (part.type) {
      case "text-delta":
        census.textChunks += 1;
        census.textChars += String(part.text ?? part.delta ?? "").length;
        text += String(part.text ?? part.delta ?? "");
        break;
      case "reasoning-delta":
        census.reasoningChunks += 1;
        break;
      case "tool-call":
        census.toolCalls += 1;
        break;
      case "tool-result":
        census.toolResults += 1;
        break;
      case "raw": {
        let parsed: unknown = part.rawValue;
        if (typeof part.rawValue === "string") {
          try {
            parsed = JSON.parse(part.rawValue);
          } catch {
            parsed = part.rawValue;
          }
        }
        census.rawParts.push(parsed);
        break;
      }
      case "finish":
        census.finishReason = String(part.finishReason ?? "");
        break;
      default:
        break;
    }
  }
  return { text, census };
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

export function logSection(title: string): void {
  console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`);
}

/** Count lingering opencode ACP children that look like ours (best-effort). */
export async function countOpenCodeAcpProcesses(): Promise<number> {
  const proc = Bun.spawn(["ps", "-ax", "-o", "pid=,command="], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("opencode") && l.includes("acp") && !l.includes("ps -ax"))
    .length;
}
