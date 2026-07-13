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

/** Compact label — never put the full shell command on the button. */
export function displayApprovalOptionLabel(option: ApprovalOptionLike): string {
  const full = approvalOptionFullLabel(option).trim();
  const kindKey = option.kind;
  const kindShort =
    (kindKey ? KIND_SHORT_LABEL[kindKey] : undefined) ??
    (kindKey ? KIND_SHORT_LABEL[normalizeKind(kindKey) ?? ""] : undefined);

  if (kindShort && looksLikeEmbeddedCommand(full)) {
    return kindShort;
  }

  if (/^yes\b/i.test(full) && /don'?t ask|always|permanently/i.test(full)) {
    return kindShort ?? "不再询问";
  }
  if (/^yes\b/i.test(full) && full.length > 16) {
    return kindShort ?? "允许一次";
  }
  if (/^(no|reject|deny)\b/i.test(full) && full.length > 16) {
    return kindShort ?? "拒绝";
  }
  if (/^always\s+allow\b/i.test(full) || /don'?t ask again/i.test(full)) {
    return kindShort ?? "不再询问";
  }
  if (/^allow\b/i.test(full) && full.length <= 12) {
    return "允许一次";
  }
  if (/^deny\b|^reject\b/i.test(full) && full.length <= 12) {
    return "拒绝";
  }

  if (full.length <= 24) return full;
  if (kindShort) return kindShort;
  return `${full.slice(0, 22)}…`;
}

export function isApprovalAllowKind(kind: string | undefined): boolean {
  const k = normalizeKind(kind);
  return k === "allow_once" || k === "allow_always";
}
