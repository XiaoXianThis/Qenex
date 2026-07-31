import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createSession,
  deleteSession,
  formatBridgeError,
  loadLastCwd,
  saveLastCwd,
  type SessionInfo,
} from "@qenex/core";
import { useQenexHost } from "./host.tsx";
import { ChatRuntime } from "./chat-runtime.tsx";

function shortId(sessionId: string): string {
  return sessionId.length <= 10 ? sessionId : sessionId.slice(0, 8);
}

function cwdLeaf(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}

export function App() {
  const host = useQenexHost();
  const [cwd, setCwd] = useState(() => loadLastCwd(host));
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const starting = useRef(false);

  const canPick = Boolean(host.pickWorkspace);
  const active = useMemo(
    () => sessions.find((s) => s.sessionId === activeId) ?? null,
    [sessions, activeId],
  );

  useEffect(() => {
    if (sessions.length === 0) {
      setShowNewForm(true);
      return;
    }
    if (!activeId || !sessions.some((s) => s.sessionId === activeId)) {
      setActiveId(sessions[0]!.sessionId);
    }
  }, [sessions, activeId]);

  async function onPick() {
    if (!host.pickWorkspace) return;
    const picked = await host.pickWorkspace();
    if (picked) setCwd(picked);
  }

  async function createNewSession(e?: FormEvent) {
    e?.preventDefault();
    if (starting.current) return;
    const trimmed = cwd.trim();
    if (!trimmed) {
      setError("请填写工作区路径（cwd）");
      return;
    }
    starting.current = true;
    setBusy(true);
    setError(null);
    try {
      const info = await createSession(host, trimmed);
      saveLastCwd(host, trimmed);
      setSessions((current) => [...current, info]);
      setActiveId(info.sessionId);
      setShowNewForm(false);
    } catch (err) {
      setError(formatBridgeError(err));
    } finally {
      setBusy(false);
      starting.current = false;
    }
  }

  async function onDeleteSession(sessionId: string) {
    setError(null);
    try {
      await deleteSession(host, sessionId);
    } catch (err) {
      setError(formatBridgeError(err));
      return;
    }
    setSessions((current) => {
      const next = current.filter((s) => s.sessionId !== sessionId);
      if (activeId === sessionId) {
        setActiveId(next[0]?.sessionId ?? null);
      }
      if (next.length === 0) setShowNewForm(true);
      return next;
    });
  }

  async function onCloseAll() {
    setError(null);
    const ids = sessions.map((s) => s.sessionId);
    for (const id of ids) {
      try {
        await deleteSession(host, id);
      } catch {
        /* best-effort */
      }
    }
    setSessions([]);
    setActiveId(null);
    setShowNewForm(true);
  }

  const gateForm = (
    <form className="qenex-gate-form" onSubmit={(e) => void createNewSession(e)}>
      <label className="qenex-label">
        工作区路径（cwd）
        <div className="qenex-cwd-row">
          <input
            className="qenex-input"
            value={cwd}
            onChange={(ev) => setCwd(ev.target.value)}
            placeholder="/path/to/project"
            autoFocus
            disabled={busy}
          />
          {canPick ? (
            <button
              type="button"
              className="qenex-btn"
              onClick={() => void onPick()}
              disabled={busy}
            >
              浏览…
            </button>
          ) : null}
        </div>
      </label>
      {error ? <p className="qenex-error">{error}</p> : null}
      <div className="qenex-gate-actions">
        <button type="submit" className="qenex-btn primary" disabled={busy}>
          {busy ? "正在创建 session…" : sessions.length ? "创建会话" : "开始聊天"}
        </button>
        {sessions.length > 0 ? (
          <button
            type="button"
            className="qenex-btn ghost"
            disabled={busy}
            onClick={() => {
              setShowNewForm(false);
              setError(null);
            }}
          >
            取消
          </button>
        ) : null}
      </div>
    </form>
  );

  return (
    <div
      className={
        sessions.length
          ? "qenex-shell qenex-shell-chat"
          : "qenex-shell"
      }
    >
      <header className="qenex-header">
        <div className="qenex-brand">
          <span className="qenex-logo">Qenex</span>
          <span className="qenex-muted">OpenCode · AI SDK</span>
        </div>
        {sessions.length ? (
          <div className="qenex-session-meta">
            {active ? (
              <code title={active.cwd}>{active.cwd}</code>
            ) : null}
            <button
              type="button"
              className="qenex-btn ghost"
              onClick={() => void onCloseAll()}
            >
              关闭全部
            </button>
          </div>
        ) : null}
      </header>

      {sessions.length === 0 || showNewForm ? (
        <main className={sessions.length ? "qenex-gate qenex-gate-inline" : "qenex-gate"}>
          <h1>{sessions.length ? "新建会话" : "选择工作区"}</h1>
          <p className="qenex-muted">
            {sessions.length
              ? "可在同一 Bridge 上再开一个 OpenCode session，互不串话。"
              : "Web 壳会在本地 Bridge 上创建 OpenCode ACP session，然后进入聊天。"}
          </p>
          {gateForm}
        </main>
      ) : (
        <main className="qenex-chat">
          <nav className="qenex-session-tabs" aria-label="会话列表">
            {sessions.map((session) => {
              const selected = session.sessionId === activeId;
              return (
                <div
                  key={session.sessionId}
                  className={
                    selected
                      ? "qenex-session-tab active"
                      : "qenex-session-tab"
                  }
                >
                  <button
                    type="button"
                    className="qenex-session-tab-main"
                    aria-pressed={selected}
                    title={session.cwd}
                    onClick={() => setActiveId(session.sessionId)}
                  >
                    <span className="qenex-session-tab-name">
                      {cwdLeaf(session.cwd)}
                    </span>
                    <span className="qenex-session-tab-id">
                      {shortId(session.sessionId)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="qenex-session-tab-close"
                    title="删除会话"
                    aria-label={`删除会话 ${shortId(session.sessionId)}`}
                    onClick={() => void onDeleteSession(session.sessionId)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="qenex-session-tab-add"
              title="新建会话"
              onClick={() => {
                setShowNewForm(true);
                setError(null);
              }}
            >
              + 新建
            </button>
          </nav>
          {error ? <p className="qenex-error qenex-session-error">{error}</p> : null}
          {active ? (
            <ChatRuntime
              key={active.sessionId}
              sessionId={active.sessionId}
            />
          ) : null}
        </main>
      )}
    </div>
  );
}
