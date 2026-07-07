import { useMemo, useEffect, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { ApprovalBridge } from "@/components/ApprovalBridge";
import { TabTitleBridge } from "@/components/TabTitleBridge";
import {
  BridgeHttpAgent,
  SessionConfigProvider,
  createBridgeHistoryAdapter,
  getAguiUrl,
  useTabsStore,
  type RuntimeSessionConfig,
} from "@qenex/core";

type AgentRuntimeProviderProps = {
  session: RuntimeSessionConfig;
  children: React.ReactNode;
};

type AgentRuntimeProviderInnerProps = AgentRuntimeProviderProps & {
  aguiUrl: string;
};

function AgentRuntimeProviderInner({
  session,
  aguiUrl,
  children,
}: AgentRuntimeProviderInnerProps) {
  const clearHistoryLoad = useTabsStore((s) => s.clearHistoryLoad);

  const agent = useMemo(
    () =>
      new BridgeHttpAgent(
        aguiUrl,
        { cwd: session.cwd, agentCommand: session.agentCommand },
        session.threadId,
      ),
    [aguiUrl, session.threadId, session.cwd, session.agentCommand],
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

export function AgentRuntimeProvider({
  session,
  children,
}: AgentRuntimeProviderProps) {
  const [aguiUrl, setAguiUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAguiUrl().then((url) => {
      if (!cancelled) {
        setAguiUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!aguiUrl) {
    return null;
  }

  return (
    <AgentRuntimeProviderInner session={session} aguiUrl={aguiUrl}>
      {children}
    </AgentRuntimeProviderInner>
  );
}
