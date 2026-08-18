import { resolveShikiLang } from "@/components/assistant-ui/shiki-langs";

/** Cursor 风格工具调用：解析 args、分类、抽取展示字段 */

export type ToolViewKind =
  | "read"
  | "write"
  | "edit"
  | "grep"
  | "shell"
  | "generic";

export type ToolArgs = Record<string, unknown>;

const PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "file",
  "filename",
  "uri",
] as const;

const COMMAND_KEYS = ["command", "cmd", "shell", "script"] as const;

const PATTERN_KEYS = ["pattern", "regex", "regexp", "query", "search"] as const;

const CONTENT_KEYS = [
  "content",
  "contents",
  "file_text",
  "fileText",
  "new_string",
  "newString",
  "new_str",
  "newStr",
  "old_string",
  "oldString",
  "old_str",
  "oldStr",
  "diff",
  "patch",
  "input",
] as const;

const GLOB_KEYS = ["glob", "glob_pattern", "globPattern", "include"] as const;

const HIDDEN_GENERIC_KEYS = new Set<string>([
  ...CONTENT_KEYS,
  "__tool_use_purpose",
]);

/**
 * ACP provider wraps every call as `{ toolCallId, toolName, args: rawInput }`.
 * Classification and pickers must use the inner `args`.
 */
export function unwrapAcpToolEnvelope(args: ToolArgs): {
  toolName?: string;
  args: ToolArgs;
} {
  const inner = args.args;
  if (
    typeof args.toolCallId === "string" &&
    inner &&
    typeof inner === "object" &&
    !Array.isArray(inner)
  ) {
    return {
      toolName: typeof args.toolName === "string" ? args.toolName : undefined,
      args: inner as ToolArgs,
    };
  }
  return { args };
}

export function parseToolArgs(argsText?: string): ToolArgs {
  if (!argsText?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(argsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ToolArgs;
    }
    return { value: parsed };
  } catch {
    // 流式未完成的 JSON：当作原文展示
    return { _raw: argsText };
  }
}

function firstString(args: ToolArgs, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      const joined = value.join(" ").trim();
      if (joined) return joined;
    }
  }
  return undefined;
}

export function pickPath(args: ToolArgs): string | undefined {
  return firstString(args, PATH_KEYS);
}

export function pickPathFromResult(result: unknown): string | undefined {
  const items = Array.isArray(result) ? result : [result];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const path = (item as { path?: unknown }).path;
    if (typeof path === "string" && path.trim()) return path;
  }
  return undefined;
}

export function pickCommand(args: ToolArgs): string | undefined {
  const direct = firstString(args, COMMAND_KEYS);
  if (direct) return direct;
  // { command: { command: "rg", args: ["-n", "foo"] } } 一类嵌套
  const nested = args.command;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const obj = nested as ToolArgs;
    const name = typeof obj.command === "string" ? obj.command : undefined;
    const argv = Array.isArray(obj.args)
      ? obj.args.filter((a): a is string => typeof a === "string")
      : [];
    if (name) return [name, ...argv].join(" ");
  }
  return undefined;
}

export function pickPattern(args: ToolArgs): string | undefined {
  return firstString(args, PATTERN_KEYS);
}

export function pickGlob(args: ToolArgs): string | undefined {
  return firstString(args, GLOB_KEYS);
}

export function pickContentPreview(args: ToolArgs): string | undefined {
  for (const key of CONTENT_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function pickOldNew(args: ToolArgs): {
  oldText?: string;
  newText?: string;
} {
  const oldText =
    firstString(args, ["old_string", "oldString", "old_str", "oldStr"]) ??
    undefined;
  const newText =
    firstString(args, [
      "new_string",
      "newString",
      "new_str",
      "newStr",
      "content",
      "contents",
      "file_text",
      "fileText",
    ]) ?? undefined;
  return { oldText, newText };
}

function nameLooksLike(
  toolName: string,
  patterns: RegExp[],
): boolean {
  const n = toolName.trim();
  return patterns.some((re) => re.test(n));
}

export function classifyTool(
  toolName: string,
  args: ToolArgs,
): ToolViewKind {
  const command = pickCommand(args);
  const pattern = pickPattern(args);
  const path = pickPath(args);
  const { oldText, newText } = pickOldNew(args);
  const content = pickContentPreview(args);

  if (
    command ||
    nameLooksLike(toolName, [
      /\b(bash|shell|terminal|exec|run_terminal|run_command|命令|终端)\b/i,
      /^\$/,
    ])
  ) {
    return "shell";
  }

  if (
    pattern ||
    nameLooksLike(toolName, [
      /\b(grep|rg|search|find|ripgrep|搜索|查找)\b/i,
    ])
  ) {
    return "grep";
  }

  if (
    (oldText && newText) ||
    nameLooksLike(toolName, [
      /\b(edit|str_replace|search_replace|apply_patch|patch)\b/i,
      /编辑|替换|修改/,
    ])
  ) {
    return "edit";
  }

  if (
    (path && content && !oldText) ||
    nameLooksLike(toolName, [/\b(write|create_file|write_file)\b/i, /写入|创建文件/])
  ) {
    return "write";
  }

  if (
    path ||
    nameLooksLike(toolName, [/\b(read|read_file|open|cat)\b/i, /读取|查看文件/])
  ) {
    // 有 path 但无明显写入字段 → read；纯 path 标题也按 read
    if (!content && !oldText && !newText) return "read";
    if (path && !command && !pattern) return "read";
  }

  return "generic";
}

/**
 * Cursor 风三段展开：
 * - shell / edit / write → 默认「预览」（约 5 行），点击后完全展开
 * - read / grep / generic → 默认「完全收起」，点击后完全展开
 */
export function shouldDefaultToolPreview(kind: ToolViewKind): boolean {
  return kind === "shell" || kind === "edit" || kind === "write";
}

/** @deprecated 使用 shouldDefaultToolPreview */
export function shouldKeepToolExpanded(kind: ToolViewKind): boolean {
  return shouldDefaultToolPreview(kind);
}

export function fileBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function fileExtLabel(path: string): string {
  const base = fileBasename(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "FILE";
  return base.slice(dot + 1).toUpperCase().slice(0, 4);
}

export type DiffLineKind = "ctx" | "add" | "del" | "hunk" | "meta";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  /** 展示用行号（可为 null） */
  lineNo: number | null;
  marker: " " | "+" | "-" | "";
};

export function countDiffStats(lines: DiffLine[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === "add") additions += 1;
    if (line.kind === "del") deletions += 1;
  }
  return { additions, deletions };
}

/** 解析 unified diff；失败则返回 null */
export function parseUnifiedDiff(diff: string): DiffLine[] | null {
  const raw = diff.replace(/\r\n/g, "\n").split("\n");
  if (!raw.some((l) => l.startsWith("@@") || l.startsWith("---") || l.startsWith("+++"))) {
    return null;
  }
  const lines: DiffLine[] = [];
  let oldNo: number | null = null;
  let newNo: number | null = null;
  for (const line of raw) {
    if (line.startsWith("@@")) {
      const m = /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      lines.push({ kind: "hunk", text: line, lineNo: null, marker: "" });
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ")) {
      lines.push({ kind: "meta", text: line, lineNo: null, marker: "" });
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({
        kind: "add",
        text: line.slice(1),
        lineNo: newNo,
        marker: "+",
      });
      if (newNo != null) newNo += 1;
      continue;
    }
    if (line.startsWith("-")) {
      lines.push({
        kind: "del",
        text: line.slice(1),
        lineNo: oldNo,
        marker: "-",
      });
      if (oldNo != null) oldNo += 1;
      continue;
    }
    if (line.startsWith(" ") || line === "") {
      lines.push({
        kind: "ctx",
        text: line.startsWith(" ") ? line.slice(1) : line,
        lineNo: newNo ?? oldNo,
        marker: " ",
      });
      if (oldNo != null) oldNo += 1;
      if (newNo != null) newNo += 1;
      continue;
    }
    lines.push({ kind: "ctx", text: line, lineNo: null, marker: " " });
  }
  return lines.length > 0 ? lines : null;
}

/** 无 unified diff 时，用 old/new 拼简易行 diff（按行） */
export function buildSimpleDiffLines(
  oldText?: string,
  newText?: string,
): DiffLine[] {
  const oldLines = oldText?.replace(/\r\n/g, "\n").split("\n") ?? [];
  const newLines = newText?.replace(/\r\n/g, "\n").split("\n") ?? [];
  const lines: DiffLine[] = [];
  if (oldText != null && newText == null) {
    oldLines.forEach((text, i) => {
      lines.push({ kind: "del", text, lineNo: i + 1, marker: "-" });
    });
    return lines;
  }
  if (newText != null && oldText == null) {
    newLines.forEach((text, i) => {
      lines.push({ kind: "add", text, lineNo: i + 1, marker: "+" });
    });
    return lines;
  }
  // 极简：先列删除再列新增（非 LCS，够用）
  oldLines.forEach((text, i) => {
    lines.push({ kind: "del", text, lineNo: i + 1, marker: "-" });
  });
  newLines.forEach((text, i) => {
    lines.push({ kind: "add", text, lineNo: i + 1, marker: "+" });
  });
  return lines;
}

function firstDiffishString(args: ToolArgs): string | null {
  for (const key of ["diff", "patch", "input"] as const) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function buildEditDiffLines(args: ToolArgs): DiffLine[] {
  const diffish = firstDiffishString(args);
  if (diffish) {
    const parsed = parseUnifiedDiff(diffish);
    if (parsed) return parsed;
    return diffish.split("\n").map((text, i) => ({
      kind: "ctx" as const,
      text,
      lineNo: i + 1,
      marker: " " as const,
    }));
  }
  const { oldText, newText } = pickOldNew(args);
  return buildSimpleDiffLines(oldText, newText);
}

/** Cursor/ACP result payloads that are already a diff, not args. */
export function buildResultDiffLines(result: unknown): DiffLine[] {
  const items = Array.isArray(result) ? result : [result];
  const lines: DiffLine[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const isDiff =
      o.type === "diff" ||
      (typeof o.path === "string" &&
        (typeof o.newText === "string" || typeof o.oldText === "string"));
    if (!isDiff) continue;
    if (typeof o.path === "string") {
      lines.push({
        kind: "meta",
        text: o.path,
        lineNo: null,
        marker: "",
      });
    }
    lines.push(
      ...buildSimpleDiffLines(
        typeof o.oldText === "string" ? o.oldText : undefined,
        typeof o.newText === "string" ? o.newText : undefined,
      ),
    );
  }
  return lines;
}

function formatDiffResult(o: Record<string, unknown>): string {
  const path = typeof o.path === "string" ? o.path : "";
  const oldText = typeof o.oldText === "string" ? o.oldText : "";
  const newText = typeof o.newText === "string" ? o.newText : "";
  const parts: string[] = [];
  if (path) parts.push(path);
  if (oldText) parts.push(oldText);
  if (newText) parts.push(newText);
  return parts.join("\n");
}

function exitCodeOf(o: Record<string, unknown>): number | undefined {
  const code = o.exit_code ?? o.exitCode;
  return typeof code === "number" ? code : undefined;
}

/** Pull readable text out of ACP / Codex / Cursor tool payloads. */
function textFromUnknown(value: unknown, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => textFromUnknown(item, depth + 1))
      .filter((text): text is string => Boolean(text));
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (typeof value !== "object") return null;
  const o = value as Record<string, unknown>;

  if (typeof o.formatted_output === "string") {
    const code = exitCodeOf(o);
    if (code != null && code !== 0) {
      const body = o.formatted_output.replace(/\s+$/, "");
      return body ? `${body}\nexit ${code}` : `exit ${code}`;
    }
    return o.formatted_output;
  }
  if (typeof o.text === "string") return o.text;
  if (o.type === "content") return textFromUnknown(o.content, depth + 1);
  if (typeof o.content === "string") return o.content;
  if (typeof o.output === "string") return o.output;
  if (typeof o.stdout === "string") {
    const err =
      typeof o.stderr === "string" && o.stderr.trim() ? `\n${o.stderr}` : "";
    return `${o.stdout}${err}`;
  }
  if (
    o.type === "diff" ||
    (typeof o.path === "string" &&
      (typeof o.newText === "string" || typeof o.oldText === "string"))
  ) {
    return formatDiffResult(o);
  }
  if (o.content != null && typeof o.content === "object") {
    return textFromUnknown(o.content, depth + 1);
  }
  return null;
}

/** 把 result / progress 收成可读纯文本 */
export function formatResultText(result: unknown): string | null {
  const extracted = textFromUnknown(result);
  if (extracted != null) return extracted;
  if (result === undefined || result === null) return null;
  if (typeof result === "object") {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

export function truncateText(text: string, maxChars = 4000): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n…`, truncated: true };
}

export function detectToolCodeLanguage(
  text: string,
  opts?: { kind?: ToolViewKind; path?: string },
): string {
  if (opts?.kind === "shell") return "bash";

  const path = opts?.path?.trim();
  if (path) {
    const base = fileBasename(path);
    const dot = base.lastIndexOf(".");
    if (dot > 0 && dot < base.length - 1) {
      return resolveShikiLang(base.slice(dot + 1));
    }
  }

  const trimmed = text.trim();
  if (!trimmed) return "text";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "text";
}

export function prettifyToolCodeText(
  text: string,
  language?: string,
  opts?: { kind?: ToolViewKind; path?: string },
): { text: string; language: string } {
  const resolved =
    language?.trim() ||
    detectToolCodeLanguage(text, { kind: opts?.kind, path: opts?.path });

  if (resolved !== "json") {
    return { text, language: resolved };
  }

  const trimmed = text.trim();
  if (!trimmed) return { text: "", language: "json" };

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return { text: JSON.stringify(parsed, null, 2), language: "json" };
  } catch {
    return { text: trimmed, language: "json" };
  }
}

/** generic 视图用的 KV（跳过超大 content 字段） */
export function genericArgEntries(args: ToolArgs): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(args)) {
    if (HIDDEN_GENERIC_KEYS.has(key)) continue;
    if (key === "_raw") continue;
    if (value === undefined || value === null) continue;
    let display: string;
    if (typeof value === "string") {
      display = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    } else if (
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      display = String(value);
    } else {
      try {
        const json = JSON.stringify(value);
        display = json.length > 200 ? `${json.slice(0, 200)}…` : json;
      } catch {
        display = String(value);
      }
    }
    entries.push([key, display]);
  }
  return entries;
}

export function hasMeaningfulArgs(args: ToolArgs): boolean {
  if (args._raw) return true;
  return Object.keys(args).some((k) => k !== "__tool_use_purpose");
}
