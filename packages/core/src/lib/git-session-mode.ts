/** Preferred git session strategy for newly created tasks. */

export type GitSessionMode = "off" | "inplace" | "worktree" | "snapshot";

export const GIT_SESSION_MODE_STORAGE_KEY = "qenex:git-session-mode";

export const DEFAULT_GIT_SESSION_MODE: GitSessionMode = "worktree";

export const GIT_SESSION_MODE_OPTIONS: {
  value: GitSessionMode;
  label: string;
  description: string;
}[] = [
  {
    value: "worktree",
    label: "独立沙箱（推荐）",
    description: "每个任务在独立目录工作；撤回不会影响其他任务或主项目。",
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
    const stored = parseGitSessionMode(
      localStorage.getItem(GIT_SESSION_MODE_STORAGE_KEY),
    );
    // Snapshot is retained in the wire/storage type for old task bindings, but
    // new tasks always migrate to isolated worktrees.
    return stored === "snapshot" ? "worktree" : (stored ?? DEFAULT_GIT_SESSION_MODE);
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
