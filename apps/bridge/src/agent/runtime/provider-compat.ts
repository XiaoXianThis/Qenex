/**
 * Provider-private ACP workarounds. This is the only Bridge module allowed
 * to touch `model.client` / `model.connection`.
 *
 * AgentCompat must not import this file — 0.3.4 private APIs stay here.
 */
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { AcpToolOutputRecovery } from "./acp-tool-output.ts";
import { BridgeError } from "../../errors.ts";
import type {
  ApprovalManager,
  PermissionRequestParams,
  PermissionResponse,
} from "../../approval-manager.ts";

type PermissionAwareModel = {
  connection?: {
    setSessionConfigOption?: (params: {
      sessionId: string;
      configId: string;
      value: string;
    }) => Promise<{ configOptions?: unknown }>;
  };
  client?: {
    setPermissionRequestHandler?: (
      handler: (params: PermissionRequestParams) => Promise<PermissionResponse>,
    ) => void;
    readTextFile?: (params: {
      sessionId: string;
      path: string;
      line?: number | null;
      limit?: number | null;
    }) => Promise<{ content: string }> | { content: string };
    writeTextFile?: (params: {
      sessionId: string;
      path: string;
      content: string;
    }) => Promise<Record<string, never>> | Record<string, never>;
    sessionUpdate?: (params: {
      update?: {
        sessionUpdate?: string;
        status?: string | null;
        rawOutput?: unknown;
        content?: unknown;
        configOptions?: unknown;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }) => Promise<void>;
  };
};

function providerModel(provider: ACPProvider): PermissionAwareModel {
  return provider.languageModel() as unknown as PermissionAwareModel;
}

type ForceCleanupModel = PermissionAwareModel & {
  forceCleanup?: () => void;
};

/** persistSession makes public `cleanup()` a no-op; kill the ACP child anyway. */
export function forceCleanupProvider(provider: ACPProvider): void {
  const model = provider.languageModel() as unknown as ForceCleanupModel;
  try {
    model.forceCleanup?.();
  } catch {
    /* ignore */
  }
  try {
    provider.cleanup();
  } catch {
    /* ignore */
  }
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Provider 0.3.4: `session/set_config_option` is only on `model.connection`.
 * Remove when ACPProvider exposes a public setConfigOption (or equivalent).
 */
export async function setSessionConfigOption(
  provider: ACPProvider,
  params: { sessionId: string; configId: string; value: string },
): Promise<{ configOptions?: unknown } | undefined> {
  const model = providerModel(provider);
  const setter = model.connection?.setSessionConfigOption?.bind(model.connection);
  if (!setter) return undefined;
  return setter(params);
}

/**
 * Install permission + fs handlers and Provider 0.3.4 stream workarounds.
 * `remoteSessionId` is the ACP session id (not the UI local id).
 */
export function installClientHandlers(
  provider: ACPProvider,
  approvals: ApprovalManager,
  cwd: string,
  remoteSessionId: string,
  onConfigOptions?: (configOptions: unknown) => void,
): void {
  const model = providerModel(provider);
  if (!model.client?.setPermissionRequestHandler) {
    throw new BridgeError(
      "permission_bridge_unavailable",
      "The installed ACP provider does not expose the permission callback required by Qenex. Check the pinned @mcpc-tech/acp-ai-provider version.",
      500,
    );
  }
  model.client.setPermissionRequestHandler((params) =>
    approvals.handlePermissionRequest(params),
  );

  const originalSessionUpdate = model.client.sessionUpdate?.bind(model.client);
  if (originalSessionUpdate) {
    const recovery = new AcpToolOutputRecovery();
    model.client.sessionUpdate = (params) => {
      const update = params.update;
      if (Array.isArray(update?.configOptions)) {
        onConfigOptions?.(update.configOptions);
      }
      const patched = recovery.patch(update);
      if (patched !== undefined && patched !== update) {
        return originalSessionUpdate({ ...params, update: patched });
      }
      return originalSessionUpdate(params);
    };
  }

  installWorkspaceFsHandlers(model, cwd, remoteSessionId);
}

/**
 * Provider 0.3.4 advertises fs support as false, but agents can still issue
 * fs/read_text_file and fs/write_text_file after an approved edit.
 * Public sandbox for every agent — not OpenCode-only.
 * Remove when the provider implements ACP fs methods with workspace confinement.
 */
function installWorkspaceFsHandlers(
  model: PermissionAwareModel,
  cwd: string,
  remoteSessionId: string,
): void {
  if (!model.client) return;
  const realCwd = realpathSync(cwd);
  const assertSession = (received: string) => {
    if (received !== remoteSessionId) {
      throw new Error(`ACP filesystem request has wrong sessionId: ${received}`);
    }
  };
  model.client.readTextFile = (params) => {
    assertSession(params.sessionId);
    const target = realpathSync(resolve(cwd, params.path));
    if (!isWithin(realCwd, target)) {
      throw new Error(`ACP read is outside the session workspace: ${params.path}`);
    }
    const content = readFileSync(target, "utf8");
    if (params.line == null && params.limit == null) return { content };
    const start = Math.max(0, (params.line ?? 1) - 1);
    const end = params.limit == null ? undefined : start + Math.max(0, params.limit);
    return { content: content.split("\n").slice(start, end).join("\n") };
  };
  model.client.writeTextFile = (params) => {
    assertSession(params.sessionId);
    const target = resolve(cwd, params.path);
    if (existsSync(target)) {
      const realTarget = realpathSync(target);
      if (!isWithin(realCwd, realTarget)) {
        throw new Error(`ACP write is outside the session workspace: ${params.path}`);
      }
    }
    const realParent = realpathSync(dirname(target));
    if (!isWithin(realCwd, realParent)) {
      throw new Error(`ACP write is outside the session workspace: ${params.path}`);
    }
    writeFileSync(target, params.content, "utf8");
    return {};
  };
}
