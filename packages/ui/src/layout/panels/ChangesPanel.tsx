"use client";

import {
  getTaskGit,
  getTaskGitDiff,
  mergeTaskGit,
  rewindTaskGit,
  unrewindTaskGit,
  useTabsStore,
  type GitChangedFile,
  type GitTurnCommit,
  type TaskGitResponse,
} from "@qenex/core";
import {
  FileDiff,
  GitBranch,
  GitMerge,
  Loader2,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useState, type FC } from "react";

function shortSha(sha: string | null | undefined): string {
  if (!sha) return "—";
  return sha.slice(0, 7);
}

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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!taskId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await getTaskGit(taskId);
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
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

  if (!taskId) {
    return (
      <div className="text-muted-foreground px-3 py-2 text-sm">
        打开会话后可查看代码改动
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        加载改动…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="px-3 py-2 text-sm text-destructive">
        {error}
        <button
          type="button"
          className="text-muted-foreground ml-2 underline"
          onClick={() => void refresh()}
        >
          重试
        </button>
      </div>
    );
  }

  if (!data?.binding.enabled) {
    return (
      <div className="border-border/60 bg-muted/20 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
        <GitBranch className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">Changes</div>
          <div className="text-muted-foreground text-xs">
            当前工作区不是 git 仓库，旁支改动未启用。聊天仍可正常使用。
          </div>
        </div>
      </div>
    );
  }

  const { binding, files, turns, aheadOfBase, dirty } = data;
  const canUnrewind = Boolean(binding.preRewindSha);

  return (
    <div className="border-border/60 bg-muted/10 flex max-h-[min(70vh,520px)] flex-col gap-2 overflow-hidden rounded-lg border text-sm">
      <div className="border-border/50 flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            <FileDiff className="h-3.5 w-3.5 shrink-0" />
            Changes
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {binding.agentBranch}
            {aheadOfBase > 0 ? ` · ${aheadOfBase} turn` : ""}
            {dirty ? " · 未提交" : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canUnrewind ? (
            <button
              type="button"
              title="恢复 rewind 前"
              disabled={busy}
              className="hover:bg-accent rounded p-1 disabled:opacity-50"
              onClick={() => void runAction(() => unrewindTaskGit(taskId))}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            title={
              binding.baseBranch
                ? `合并到 ${binding.baseBranch}`
                : "无 base 分支"
            }
            disabled={busy || !binding.baseBranch || aheadOfBase === 0}
            className="hover:bg-accent rounded p-1 disabled:opacity-50"
            onClick={() => {
              if (
                !window.confirm(
                  `将 ${binding.agentBranch} 合并到 ${binding.baseBranch}？`,
                )
              ) {
                return;
              }
              void runAction(() => mergeTaskGit(taskId));
            }}
          >
            <GitMerge className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-destructive px-3 text-xs">{error}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <section className="mb-2">
          <div className="text-muted-foreground mb-1 px-1 text-xs font-medium uppercase tracking-wide">
            文件
          </div>
          {files.length === 0 ? (
            <div className="text-muted-foreground px-1 text-xs">相对 base 无改动</div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {files.map((f: GitChangedFile) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className={`hover:bg-accent flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs ${
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
        </section>

        {selectedFile && diff !== null ? (
          <section className="mb-2">
            <div className="text-muted-foreground mb-1 px-1 text-xs font-medium">
              Diff · {selectedFile}
            </div>
            <pre className="bg-background/80 max-h-40 overflow-auto rounded border p-2 font-mono text-[10px] leading-snug whitespace-pre-wrap">
              {diff}
            </pre>
          </section>
        ) : null}

        <section>
          <div className="text-muted-foreground mb-1 px-1 text-xs font-medium uppercase tracking-wide">
            Turns
          </div>
          {turns.length === 0 ? (
            <div className="text-muted-foreground px-1 text-xs">
              尚无 turn commit（Agent 改文件并跑完一轮后会出现）
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {[...turns].reverse().map((t: GitTurnCommit) => (
                <li
                  key={t.commitSha}
                  className="hover:bg-accent/60 flex items-center gap-1 rounded px-1.5 py-1"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs">
                      {shortSha(t.commitSha)}
                    </div>
                    <div className="text-muted-foreground truncate text-[10px]">
                      {t.message.split("\n")[0]}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="回退到此 turn"
                    disabled={busy}
                    className="hover:bg-accent shrink-0 rounded p-1 disabled:opacity-50"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `硬重置旁支到 ${shortSha(t.commitSha)}？未提交改动会丢失。`,
                        )
                      ) {
                        return;
                      }
                      void runAction(() =>
                        rewindTaskGit(taskId, t.commitSha),
                      );
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
