"use client";

import {
  getTaskGit,
  getTaskGitDiff,
  mergeTaskGit,
  undoAllTaskGit,
  unrewindTaskGit,
  useTabsStore,
  type GitChangedFile,
  type TaskGitResponse,
} from "@qenex/core";
import {
  ChevronDown,
  ChevronRight,
  FileDiff,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useState, type FC } from "react";

function fileStatusLabel(status: string): string {
  switch (status.charAt(0).toUpperCase()) {
    case "A":
      return "新增";
    case "M":
      return "修改";
    case "D":
      return "删除";
    case "R":
      return "重命名";
    default:
      return status || "?";
  }
}

export const ChangesPanel: FC = () => {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const taskId = activeTab?.taskId;

  const [data, setData] = useState<TaskGitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!taskId) {
      setData(null);
      return;
    }
    setError(null);
    try {
      const next = await getTaskGit(taskId);
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
    if (!taskId) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(id);
  }, [refresh, taskId]);

  useEffect(() => {
    setSelectedFile(null);
    setDiff(null);
    setExpanded(false);
  }, [taskId]);

  const loadDiff = async (file: string) => {
    if (!taskId) return;
    setSelectedFile(file);
    setDiff(null);
    try {
      const res = await getTaskGitDiff(taskId, { file });
      setDiff(res.diff || "(无差异)");
    } catch (e) {
      setDiff(e instanceof Error ? e.message : String(e));
    }
  };

  const runAction = async (fn: () => Promise<unknown>) => {
    if (!taskId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      if (selectedFile) {
        await loadDiff(selectedFile);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Hide when: no session, not a git repo, or no file changes.
  if (!taskId || !data?.binding.enabled) {
    return null;
  }

  const { binding, files, aheadOfBase, dirty } = data;
  const fileCount = files.length;
  const hasChanges = fileCount > 0 || dirty || aheadOfBase > 0;
  if (!hasChanges && !binding.preRewindSha) {
    return null;
  }

  const canUnrewind = Boolean(binding.preRewindSha);
  const canUndo = hasChanges;
  const mode = binding.mode ?? (binding.worktreePath ? "worktree" : "snapshot");
  const canKeep =
    mode === "snapshot"
      ? aheadOfBase > 0 && !dirty
      : Boolean(binding.baseBranch) && aheadOfBase > 0 && !dirty;

  const modeBadge =
    mode === "worktree"
      ? "沙箱"
      : mode === "inplace"
        ? "旁支"
        : mode === "snapshot"
          ? "快照"
          : null;

  const undoConfirm =
    mode === "worktree"
      ? "撤销本会话全部文件改动？沙箱工作区将重置到会话开始时的状态（不影响项目主目录未提交改动）。"
      : mode === "snapshot"
        ? "撤销本会话全部文件改动？将把项目目录中的文件重置到会话开始时的状态（会改写磁盘上的文件）。"
        : "撤销本会话全部文件改动？工作区将硬重置到会话开始时的提交。";

  const keepTitle =
    mode === "snapshot"
      ? "将当前改动提交到项目仓库当前分支"
      : mode === "worktree"
        ? binding.baseBranch
          ? `合并到 ${binding.baseBranch}（需项目工作区已在该分支且干净）`
          : "无 base 分支"
        : binding.baseBranch
          ? `合并旁支到 ${binding.baseBranch}`
          : "无 base 分支";

  const keepConfirm =
    mode === "snapshot"
      ? "Keep：将当前工作区改动提交到项目仓库的当前分支？"
      : mode === "worktree"
        ? `Keep：将 ${binding.agentBranch} 合并到 ${binding.baseBranch}？\n\n请确认项目工作区当前已在「${binding.baseBranch}」且无未提交改动；合并不会自动切换分支。`
        : `Keep：检出 ${binding.baseBranch} 并合并 ${binding.agentBranch}？`;

  return (
    <div className="border-border/60 bg-muted/10 flex flex-col overflow-hidden rounded-(--composer-radius) border text-sm">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="hover:bg-accent flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-full px-1 py-1 text-left"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          )}
          <FileDiff className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate font-medium">
            {fileCount === 0
              ? "无文件改动"
              : `${fileCount} 个文件`}
          </span>
          {modeBadge ? (
            <span
              className="text-muted-foreground max-w-[8rem] shrink-0 truncate text-xs"
              title={
                mode === "worktree" && binding.worktreePath
                  ? `沙箱：${binding.worktreePath}\n项目：${binding.cwd || binding.repoRoot}`
                  : mode === "snapshot" && binding.shadowGitDir
                    ? `影子：${binding.shadowGitDir}`
                    : `模式：${mode}`
              }
            >
              {modeBadge}
            </span>
          ) : null}
          {dirty ? (
            <span className="text-muted-foreground shrink-0 text-xs">未提交</span>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {canUnrewind ? (
            <button
              type="button"
              title="恢复 Undo 前"
              disabled={busy}
              className="hover:bg-accent cursor-pointer rounded-full p-1 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void runAction(() => unrewindTaskGit(taskId))}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || !canUndo}
            className="hover:bg-accent cursor-pointer rounded-full px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              if (!window.confirm(undoConfirm)) {
                return;
              }
              void runAction(() => undoAllTaskGit(taskId));
            }}
          >
            Undo
          </button>
          <button
            type="button"
            disabled={busy || !canKeep}
            className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded-full px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            title={keepTitle}
            onClick={() => {
              if (!window.confirm(keepConfirm)) {
                return;
              }
              void runAction(() => mergeTaskGit(taskId));
            }}
          >
            Keep
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-destructive px-3 pb-2 text-xs whitespace-pre-wrap">{error}</div>
      ) : null}

      {expanded && (binding.worktreePath || binding.shadowGitDir) ? (
        <div className="text-muted-foreground border-border/50 space-y-0.5 border-t px-3 py-1.5 text-[11px]">
          <div className="truncate" title={binding.cwd || binding.repoRoot}>
            项目：{binding.cwd || binding.repoRoot}
          </div>
          {binding.worktreePath ? (
            <div className="truncate" title={binding.worktreePath}>
              沙箱：{binding.worktreePath}
            </div>
          ) : null}
          {binding.shadowGitDir ? (
            <div className="truncate" title={binding.shadowGitDir}>
              影子：{binding.shadowGitDir}
            </div>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="border-border/50 max-h-[min(50vh,360px)] min-h-0 overflow-y-auto border-t px-2 py-2">
          {files.length === 0 ? (
            <div className="text-muted-foreground px-1 text-xs">
              相对 base 无改动
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {files.map((f: GitChangedFile) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className={`hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-xs ${
                      selectedFile === f.path ? "bg-accent" : ""
                    }`}
                    onClick={() => void loadDiff(f.path)}
                  >
                    <span className="text-muted-foreground w-8 shrink-0">
                      {fileStatusLabel(f.status)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {f.path}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedFile && diff !== null ? (
            <div className="mt-2">
              <div className="text-muted-foreground mb-1 px-1 text-xs font-medium">
                Diff · {selectedFile}
              </div>
              <pre className="bg-background/80 max-h-40 overflow-auto rounded-[calc(var(--composer-radius)-0.25rem)] border p-2 font-mono text-[10px] leading-snug whitespace-pre-wrap">
                {diff}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
