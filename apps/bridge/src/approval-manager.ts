import { BridgeError } from "./errors.ts";

export type ApprovalMode = "ask" | "auto";

export type PermissionOption = {
  optionId: string;
  name: string;
  kind?: string;
};

export type PermissionToolCall = {
  toolCallId: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  locations?: Array<{ path?: string; line?: number | null }> | null;
};

export type PermissionRequestParams = {
  sessionId: string;
  options: PermissionOption[];
  toolCall: PermissionToolCall;
};

export type PermissionResponse = {
  outcome: {
    outcome: "selected" | "cancelled";
    optionId?: string;
  };
};

export type PendingApproval = {
  approvalId: string;
  sessionId: string;
  createdAt: string;
  toolCall: PermissionToolCall;
  options: PermissionOption[];
};

type PendingEntry = PendingApproval & {
  resolve: (response: PermissionResponse) => void;
};

function isAllow(option: PermissionOption): boolean {
  if (option.kind) return /^allow(?:_|$)/i.test(option.kind);
  return /allow|approve|yes/i.test(`${option.optionId} ${option.name}`) ||
    /^(once|always)$/i.test(option.optionId);
}

function isReject(option: PermissionOption): boolean {
  if (option.kind) return /^reject(?:_|$)/i.test(option.kind);
  return /reject|deny|cancel|no/i.test(`${option.optionId} ${option.name}`);
}

function autoOption(options: PermissionOption[]): PermissionOption | undefined {
  return options.find((option) => option.kind === "allow_once") ??
    options.find(isAllow) ??
    options.find((option) => !isReject(option));
}

/** Session-scoped ACP permission coordinator. */
export class ApprovalManager {
  #mode: ApprovalMode = "ask";
  #pending = new Map<string, PendingEntry>();

  get mode(): ApprovalMode {
    return this.#mode;
  }

  setMode(mode: ApprovalMode): void {
    this.#mode = mode;
  }

  list(): PendingApproval[] {
    return [...this.#pending.values()].map(({ resolve: _, ...request }) => request);
  }

  async handlePermissionRequest(
    params: PermissionRequestParams,
  ): Promise<PermissionResponse> {
    if (this.#mode === "auto") {
      const option = autoOption(params.options);
      return option
        ? { outcome: { outcome: "selected", optionId: option.optionId } }
        : { outcome: { outcome: "cancelled" } };
    }

    const approvalId = crypto.randomUUID();
    return await new Promise<PermissionResponse>((resolve) => {
      this.#pending.set(approvalId, {
        approvalId,
        sessionId: params.sessionId,
        createdAt: new Date().toISOString(),
        toolCall: params.toolCall,
        options: params.options,
        resolve,
      });
    });
  }

  decide(approvalId: string, optionId: string): PendingApproval {
    const pending = this.#pending.get(approvalId);
    if (!pending) {
      throw new BridgeError(
        "approval_not_found",
        `Pending approval not found: ${approvalId}`,
        404,
      );
    }
    if (!pending.options.some((option) => option.optionId === optionId)) {
      throw new BridgeError(
        "invalid_approval_option",
        `Permission option is not available: ${optionId}`,
        400,
        { availableOptionIds: pending.options.map((option) => option.optionId) },
      );
    }

    this.#pending.delete(approvalId);
    pending.resolve({ outcome: { outcome: "selected", optionId } });
    const { resolve: _, ...request } = pending;
    return request;
  }

  cancelAll(): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const entry of pending) {
      entry.resolve({ outcome: { outcome: "cancelled" } });
    }
  }
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "ask" || value === "auto";
}
