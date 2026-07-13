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
    label: "影子快照（推荐）",
    description: "在项目目录改文件；版本记在外部影子 git，不污染分支。",
  },
  {
    value: "worktree",
    label: "独立沙箱",
    description: "Agent 在独立 worktree 中工作；主目录不被改动，路径为沙箱。",
  },
  {
    value: "inplace",
    label: "原地旁支",
    description: "在项目内检出 qenex/* 旁支；IDE 可见改动，可能切换当前分支。",
  },
  {
    value: "off",
    label: "关闭",
    description: "不启用会话级文件版本 / Changes 面板。",
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
