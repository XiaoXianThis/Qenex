import { useCallback, useMemo, useState } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { AgentRuntimeProvider } from "@/components/AgentRuntimeProvider";
import {
  AGENT_PRESETS,
  DEFAULT_AGENT_ID,
  getAgentPreset,
} from "@/config/agents";

function createThreadId() {
  return crypto.randomUUID();
}

export default function App() {
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  const [cwd, setCwd] = useState(".");
  const [threadId, setThreadId] = useState(createThreadId);
  const [draftAgentId, setDraftAgentId] = useState(DEFAULT_AGENT_ID);
  const [draftCwd, setDraftCwd] = useState(".");

  const session = useMemo(
    () => ({
      threadId,
      cwd,
      agentCommand: getAgentPreset(agentId).command,
    }),
    [threadId, cwd, agentId],
  );

  const applySession = useCallback(() => {
    setAgentId(draftAgentId);
    setCwd(draftCwd.trim() || ".");
    setThreadId(createThreadId());
  }, [draftAgentId, draftCwd]);

  const activeAgent = getAgentPreset(agentId);

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b bg-card px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div>
            <h1 className="text-lg font-semibold">Agent Center</h1>
            <p className="text-sm text-muted-foreground">
              assistant-ui + AG-UI → backend-rs（默认 OpenCode）
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted-foreground">ACP Agent</span>
              <select
                className="h-9 rounded-md border bg-background px-3"
                value={draftAgentId}
                onChange={(e) => setDraftAgentId(e.target.value)}
              >
                {AGENT_PRESETS.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-[2] flex-col gap-1 text-sm">
              <span className="text-muted-foreground">工作目录 (cwd)</span>
              <input
                className="h-9 rounded-md border bg-background px-3"
                value={draftCwd}
                onChange={(e) => setDraftCwd(e.target.value)}
                placeholder="."
              />
            </label>

            <button
              type="button"
              onClick={applySession}
              className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90"
            >
              应用并新建会话
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            当前会话：{activeAgent.name} · cwd={cwd} · thread={threadId.slice(0, 8)}…
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4 py-4">
        <AgentRuntimeProvider key={threadId} session={session}>
          <Thread />
        </AgentRuntimeProvider>
      </main>
    </div>
  );
}
