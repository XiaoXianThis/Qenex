import { useMemo, useEffect } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { ApprovalBridge } from "@/components/ApprovalBridge";
import { TabTitleBridge } from "@/components/TabTitleBridge";
import {
  AGUI_URL,
  BridgeHttpAgent,
  SessionConfigProvider,
  createBridgeHistoryAdapter,
  useTabsStore,
  type RuntimeSessionConfig,
} from "@qenex/core";

type AgentRuntimeProviderProps = {
  session: RuntimeSessionConfig;
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
        <TabTitleBridge
          agent={agent}
          tabId={session.tabId}
          threadId={session.threadId}
        />
        <ApprovalBridge threadId={session.threadId} />
        {children}
      </AssistantRuntimeProvider>
    </SessionConfigProvider>
  );
}
