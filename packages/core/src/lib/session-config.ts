import type { AuthMethodInfo } from "./bridge-client.ts";

export type { AuthMethodInfo };

export type SessionOption = {
  id: string;
  name: string;
  description?: string;
};

/** Structured auth challenge when ACP requires login before session/new. */
export type AuthChallenge = {
  detail: string;
  methods: AuthMethodInfo[];
  agentName?: string | null;
};

export type SessionConfig = {
  modes: SessionOption[];
  models: SessionOption[];
  thoughtLevels: SessionOption[];
  currentModeId: string | null;
  currentModelId: string | null;
  currentThoughtLevelId: string | null;
  thoughtLevelConfigId: string | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** Present when spawn failed with ACP auth_required. */
  authChallenge: AuthChallenge | null;
};

export const EMPTY_SESSION_CONFIG: SessionConfig = {
  modes: [],
  models: [],
  thoughtLevels: [],
  currentModeId: null,
  currentModelId: null,
  currentThoughtLevelId: null,
  thoughtLevelConfigId: null,
  ready: false,
  loading: false,
  error: null,
  authChallenge: null,
};

export function parseSessionOptions(value: unknown): SessionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): SessionOption | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = String(record.id ?? record.value ?? "");
      const name = String(record.name ?? record.label ?? id);
      if (!id) {
        return null;
      }
      const description =
        typeof record.description === "string" ? record.description : undefined;
      return description ? { id, name, description } : { id, name };
    })
    .filter((item): item is SessionOption => item !== null);
}

export function optionLabel(
  options: SessionOption[],
  currentId: string | null,
  fallback = "默认",
): string {
  if (!currentId) {
    return options[0]?.name ?? fallback;
  }
  return options.find((option) => option.id === currentId)?.name ?? currentId;
}
