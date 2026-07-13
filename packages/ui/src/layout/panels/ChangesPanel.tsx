"use client";

import {
  changesActions,
  getTaskGit,
  getTaskGitDiff,
  mergeTaskGit,
  undoAllTaskGit,
  unrewindTaskGit,
  useChangesRefreshNonce,
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

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  const truncated = lines.length > 400;
  const shown = truncated ? lines.slice(0, 400) : lines;

  return (
    <pre className="bg-background/80 max-h-48 overflow-auto rounded-[calc(var(--composer-radius)-0.25rem)] border p-2 font-mono text-[10px] leading-snug">
      {shown.map((line, i) => {
        let color = "text-foreground/80";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          color = "text-emerald-600 dark:text-emerald-400";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          color = "text-red-600 dark:text-red-400";
        } else if (line.startsWith("@@")) {
          color = "text-sky-600 dark:text-sky-400";
        } else if (line.startsWith("diff ") || line.startsWith("index ")) {
          color = "text-muted-foreground";
        }
        return (
          <div key={i} className={`whitespace-pre-wrap ${color}`}>
            {line || " "}
          </div>
        );
      })}
      {truncated ? (
        <div className="text-muted-foreground mt-1">… diff 过长，已截断</div>
      ) : null}
    </pre>
  );
}

export const ChangesPanel: FC = () => {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const taskId = activeTab?.taskId;
  const refreshNonce = useChangesRefreshNonce(taskId);

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
  }, [refresh, refreshNonce]);

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
      changesActions.bump(taskId);
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

  const undoConfirm =
    "还原到本会话开始时的检查点？之后的文件改动都会丢弃。";
  const keepTitle = "保留当前改动到项目仓库";
  const keepConfirm = "保留这些改动到项目仓库？";

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
              ? "检查点 · 无文件改动"
              : `检查点 · ${fileCount} 个文件`}
          </span>
          {dirty ? (
            <span className="text-muted-foreground shrink-0 text-xs">未提交</span>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {canUnrewind ? (
            <button
              type="button"
              title="恢复还原前"
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
            title={
              canUndo
                ? "丢弃本会话全部文件改动"
                : "当前没有可还原的改动"
            }
            className="hover:bg-accent cursor-pointer rounded-full px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              if (!window.confirm(undoConfirm)) {
                return;
              }
              void runAction(() => undoAllTaskGit(taskId));
            }}
          >
            还原
          </button>
          <button
            type="button"
            disabled={busy || !canKeep}
            className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded-full px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            title={
              canKeep
                ? keepTitle
                : dirty
                  ? "还有未落盘的改动，请等本轮结束后再保留"
                  : "没有可保留的改动"
            }
            onClick={() => {
              if (!window.confirm(keepConfirm)) {
                return;
              }
              void runAction(() => mergeTaskGit(taskId));
            }}
          >
            保留
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-destructive px-3 pb-2 text-xs whitespace-pre-wrap">{error}</div>
      ) : null}

      {expanded ? (
        <div className="border-border/50 max-h-[min(50vh,360px)] min-h-0 overflow-y-auto border-t px-2 py-2">
          {files.length === 0 ? (
            <div className="text-muted-foreground px-1 text-xs">
              相对检查点无改动
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
              <DiffView diff={diff} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
