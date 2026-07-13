/** Preferred git session strategy for newly created tasks. */

export type GitSessionMode = "off" | "inplace" | "worktree" | "snapshot";

export const GIT_SESSION_MODE_STORAGE_KEY = "qenex:git-session-mode";

export const DEFAULT_GIT_SESSION_MODE: GitSessionMode = "snapshot";

export const GIT_SESSION_MODE_OPTIONS: {
  value: GitSessionMode;
  label: string;
  description: string;
}[] = [
  {
    value: "snapshot",
    label: "检查点（推荐）",
    description:
      "像 Cursor：在项目里改文件，用外部检查点记录版本，不污染你的分支。",
  },
  {
    value: "worktree",
    label: "独立沙箱",
    description: "Agent 在隔离目录工作；主项目不被直接改动（高级）。",
  },
  {
    value: "inplace",
    label: "旁支模式",
    description: "在仓库里切到会话旁支；IDE 可见改动，可能切换当前分支（高级）。",
  },
  {
    value: "off",
    label: "关闭",
    description: "不启用检查点 / 还原 / 保留。",
  },
];

export function parseGitSessionMode(value: unknown): GitSessionMode | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "off" || v === "inplace" || v === "worktree" || v === "snapshot") {
    return v;
  }
  return null;
}

export function getPreferredGitSessionMode(): GitSessionMode {
  if (typeof localStorage === "undefined") return DEFAULT_GIT_SESSION_MODE;
  try {
    return (
      parseGitSessionMode(localStorage.getItem(GIT_SESSION_MODE_STORAGE_KEY)) ??
      DEFAULT_GIT_SESSION_MODE
    );
  } catch {
    return DEFAULT_GIT_SESSION_MODE;
  }
}

export function setPreferredGitSessionMode(mode: GitSessionMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(GIT_SESSION_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}
