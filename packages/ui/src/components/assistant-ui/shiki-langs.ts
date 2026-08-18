export const SHIKI_COMMON_LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "css",
  "html",
  "markdown",
  "bash",
  "python",
  "rust",
  "go",
  "yaml",
  "toml",
  "sql",
  "diff",
  "xml",
  "java",
  "c",
  "cpp",
  "jsonc",
  "dockerfile",
  "scss",
] as const;

export const SHIKI_LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  md: "markdown",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  rs: "rust",
  yml: "yaml",
  "c++": "cpp",
  docker: "dockerfile",
};

const COMMON_LANG_SET = new Set<string>(SHIKI_COMMON_LANGS);

/** Special languages Shiki highlights without a grammar pack. */
const SPECIAL_LANGS = new Set(["text", "plaintext", "ansi"]);

/**
 * Map a markdown fence lang to a highlighter id.
 * Unknown langs fall back to plain text so we never ship the full grammar set.
 */
export function resolveShikiLang(
  language: string | undefined | null,
): string {
  const raw = language?.trim().toLowerCase() ?? "";
  if (!raw) return "text";
  const aliased = SHIKI_LANG_ALIASES[raw] ?? raw;
  if (SPECIAL_LANGS.has(aliased)) {
    return aliased === "plaintext" ? "text" : aliased;
  }
  return COMMON_LANG_SET.has(aliased) ? aliased : "text";
}
