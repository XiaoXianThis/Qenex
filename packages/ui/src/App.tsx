import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  createSession,
  loadLastCwd,
  saveLastCwd,
  type SessionInfo,
} from "@qenex/core";
import { useQenexHost } from "./host.tsx";
import { ChatRuntime } from "./chat-runtime.tsx";

export function App() {
  const host = useQenexHost();
  const [cwd, setCwd] = useState(() => loadLastCwd(host));
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);

  const canPick = Boolean(host.pickWorkspace);

  async function onPick() {
    if (!host.pickWorkspace) return;
    const picked = await host.pickWorkspace();
    if (picked) setCwd(picked);
  }

  async function onStart(e: FormEvent) {
    e.preventDefault();
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
      setSession(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      starting.current = false;
    }
  }

  function onReset() {
    setSession(null);
    setError(null);
  }

  const header = useMemo(
    () => (
      <header className="qenex-header">
        <div className="qenex-brand">
          <span className="qenex-logo">Qenex</span>
          <span className="qenex-muted">OpenCode · AI SDK</span>
        </div>
        {session ? (
          <div className="qenex-session-meta">
            <code title={session.cwd}>{session.cwd}</code>
            <button type="button" className="qenex-btn ghost" onClick={onReset}>
              更换工作区
            </button>
          </div>
        ) : null}
      </header>
    ),
    [session],
  );

  if (!session) {
    return (
      <div className="qenex-shell">
        {header}
        <main className="qenex-gate">
          <h1>选择工作区</h1>
          <p className="qenex-muted">
            Web 壳会在本地 Bridge 上创建 OpenCode ACP session，然后进入聊天。
          </p>
          <form className="qenex-gate-form" onSubmit={onStart}>
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
                    onClick={onPick}
                    disabled={busy}
                  >
                    浏览…
                  </button>
                ) : null}
              </div>
            </label>
            {error ? <p className="qenex-error">{error}</p> : null}
            <button type="submit" className="qenex-btn primary" disabled={busy}>
              {busy ? "正在创建 session…" : "开始聊天"}
            </button>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="qenex-shell qenex-shell-chat">
      {header}
      <main className="qenex-chat">
        <ChatRuntime sessionId={session.sessionId} />
      </main>
    </div>
  );
}
