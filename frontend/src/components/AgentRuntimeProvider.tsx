import { useMemo, useEffect } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { ApprovalBridge } from "@/components/ApprovalBridge";
import { SessionConfigProvider } from "@/context/SessionConfigContext";
import { AGUI_URL } from "@/config/agents";
import { BridgeHttpAgent } from "@/lib/bridge-agent";
import { createBridgeHistoryAdapter } from "@/lib/bridge-history-adapter";
import { useTabsStore } from "@/store/tabs-store";

export type SessionConfig = {
  tabId: string;
  threadId: string;
  cwd: string;
  agentCommand: string[];
  agentSessionId?: string;
  shouldLoadHistory?: boolean;
};

type AgentRuntimeProviderProps = {
  session: SessionConfig;
  children: React.ReactNode;
};

export function AgentRuntimeProvider({
  session,
  children,
}: AgentRuntimeProviderProps) {
  const clearHistoryLoad = useTabsStore((s) => s.clearHistoryLoad);

  const agent = useMemo(
    () =>
      new BridgeHttpAgent(
        AGUI_URL,
        { cwd: session.cwd, agentCommand: session.agentCommand },
        session.threadId,
      ),
    [session.threadId, session.cwd, session.agentCommand],
  );

  const shouldLoadHistory =
    session.shouldLoadHistory === true || !!session.agentSessionId;

  const historyAdapter = useMemo(() => {
    if (!shouldLoadHistory) {
      return undefined;
    }
    return createBridgeHistoryAdapter(
      (taskId) => agent.loadHistory(taskId),
      session.threadId,
    );
  }, [shouldLoadHistory, session.threadId, agent]);

  const runtime = useAgUiRuntime({
    agent,
    adapters: historyAdapter ? { history: historyAdapter } : undefined,
  });

  useEffect(() => {
    if (!session.shouldLoadHistory) {
      return;
    }
    clearHistoryLoad(session.tabId);
  }, [session.shouldLoadHistory, session.tabId, clearHistoryLoad]);

  return (
    <SessionConfigProvider
      tabId={session.tabId}
      threadId={session.threadId}
      cwd={session.cwd}
      agentCommand={session.agentCommand}
      agentSessionId={session.agentSessionId}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <ApprovalBridge threadId={session.threadId} />
        {children}
      </AssistantRuntimeProvider>
    </SessionConfigProvider>
  );
}
