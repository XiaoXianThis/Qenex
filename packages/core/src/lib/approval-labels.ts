/** Shared short labels for ACP / assistant-ui approval options (Cursor-like). */

export type ApprovalOptionLike = {
  optionId?: string;
  id?: string;
  name?: string;
  label?: string;
  kind?: string;
};

const KIND_SHORT_LABEL: Record<string, string> = {
  allow_once: "允许一次",
  "allow-once": "允许一次",
  allow_always: "不再询问",
  "allow-always": "不再询问",
  reject_once: "拒绝",
  "reject-once": "拒绝",
  reject_always: "始终拒绝",
  "reject-always": "始终拒绝",
};

function normalizeKind(kind: string | undefined): string | undefined {
  return kind?.replace(/-/g, "_");
}

function looksLikeEmbeddedCommand(text: string): boolean {
  return (
    text.length > 28 ||
    /(?:curl|bash|zsh|cmd|powershell|npm|npx|bun|git\s|https?:\/\/|%\{|\\\\|\/[\w.-]+)/i.test(
      text,
    )
  );
}

export function approvalOptionId(option: ApprovalOptionLike): string {
  return option.optionId ?? option.id ?? "allow_once";
}

export function approvalOptionFullLabel(option: ApprovalOptionLike): string {
  return option.name ?? option.label ?? approvalOptionId(option);
}

export function approvalKindShortLabel(kind: string | undefined): string | undefined {
  if (!kind) return undefined;
  return KIND_SHORT_LABEL[kind] ?? KIND_SHORT_LABEL[normalizeKind(kind) ?? ""];
}

/** Compact label — never put the full shell command on the button. */
export function displayApprovalOptionLabel(option: ApprovalOptionLike): string {
  const full = approvalOptionFullLabel(option).trim();
  const kindShort = approvalKindShortLabel(option.kind);

  // Kind is the ACP source of truth — agents vary wildly on English `name`
  // ("Allow always" vs "Always allow" vs "Yes, and don't ask again").
  // Prefer kind so allow_always never shows as「允许一次」。
  if (kindShort) {
    return kindShort;
  }

  if (looksLikeEmbeddedCommand(full)) {
    if (/don'?t ask|always|permanently/i.test(full)) return "不再询问";
    if (/^(no|reject|deny)\b/i.test(full)) return "拒绝";
    return "允许一次";
  }

  if (/^yes\b/i.test(full) && /don'?t ask|always|permanently/i.test(full)) {
    return "不再询问";
  }
  if (/^yes\b/i.test(full) && full.length > 16) {
    return "允许一次";
  }
  if (/^(no|reject|deny)\b/i.test(full) && full.length > 16) {
    return "拒绝";
  }
  if (
    /^always\s+allow\b/i.test(full) ||
    /^allow\s+always\b/i.test(full) ||
    /don'?t ask again/i.test(full)
  ) {
    return "不再询问";
  }
  if (/^allow\b/i.test(full) && full.length <= 12) {
    return "允许一次";
  }
  if (/^deny\b|^reject\b/i.test(full) && full.length <= 12) {
    return "拒绝";
  }

  if (full.length <= 24) return full;
  return `${full.slice(0, 22)}…`;
}

export function isApprovalAllowKind(kind: string | undefined): boolean {
  const k = normalizeKind(kind);
  return k === "allow_once" || k === "allow_always";
}

export function isApprovalAlwaysAllowKind(kind: string | undefined): boolean {
  return normalizeKind(kind) === "allow_always";
}

/**
 * Pick the best allow option for auto-approve across agents.
 * Prefers allow_always when the agent offered it; otherwise allow_once / any allow.
 */
export function pickAutoAllowOption(options: ApprovalOptionLike[] | undefined): {
  optionId: string;
} {
  const list = options ?? [];
  const always = list.find((o) => isApprovalAlwaysAllowKind(o.kind));
  if (always) return { optionId: approvalOptionId(always) };

  const once = list.find((o) => normalizeKind(o.kind) === "allow_once");
  if (once) return { optionId: approvalOptionId(once) };

  const anyAllow = list.find((o) => isApprovalAllowKind(o.kind));
  if (anyAllow) return { optionId: approvalOptionId(anyAllow) };

  // No options (or unrecognized): Bridge defaults to allow_once.
  return { optionId: "allow_once" };
}
