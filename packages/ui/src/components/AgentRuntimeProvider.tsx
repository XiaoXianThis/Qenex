import { useMemo, useEffect, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { ApprovalBridge } from "@/components/ApprovalBridge";
import { TabTitleBridge } from "@/components/TabTitleBridge";
import {
  BridgeHttpAgent,
  SessionConfigProvider,
  createBridgeHistoryAdapter,
  createComposerAttachmentAdapter,
  getAguiUrl,
  getTaskStatus,
  pollTaskEvents,
  tabsActions,
  type RuntimeSessionConfig,
} from "@qenex/core";

type AgentRuntimeProviderProps = {
  session: RuntimeSessionConfig;
  children: React.ReactNode;
};

type AgentRuntimeProviderInnerProps = AgentRuntimeProviderProps & {
  aguiUrl: string;
};

const PENDING_URL_ADAPTER: ChatModelAdapter = {
  async *run() {
    // aguiUrl 解析完成前的占位 runtime
  },
};

function PendingAguiRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useLocalRuntime(PENDING_URL_ADAPTER);
  return (
    <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
  );
}

function AgentRuntimeProviderInner({
  session,
  aguiUrl,
  children,
}: AgentRuntimeProviderInnerProps) {
  const clearHistoryLoad = tabsActions.clearHistoryLoad;

  const agent = useMemo(
    () =>
      new BridgeHttpAgent(
        aguiUrl,
        {
          cwd: session.cwd,
          agentId: session.agentId,
          agentCommand:
            session.agentCommand && session.agentCommand.length > 0
              ? session.agentCommand
              : undefined,
        },
        session.threadId,
      ),
    [aguiUrl, session.threadId, session.cwd, session.agentId, session.agentCommand],
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
      {
        getStatus: getTaskStatus,
        pollEvents: pollTaskEvents,
      },
    );
  }, [shouldLoadHistory, session.threadId, agent]);

  const attachmentAdapter = useMemo(
    () => createComposerAttachmentAdapter(),
    [],
  );

  const runtime = useAgUiRuntime({
    agent,
    adapters: {
      attachments: attachmentAdapter,
      ...(historyAdapter ? { history: historyAdapter } : {}),
    },
  });

  useEffect(() => {
    if (!session.shouldLoadHistory) {
      return;
    }
    clearHistoryLoad(session.tabId);
  }, [session.shouldLoadHistory, session.tabId, clearHistoryLoad]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TabTitleBridge
        agent={agent}
        tabId={session.tabId}
        threadId={session.threadId}
      />
      <ApprovalBridge threadId={session.threadId} />
      {children}
    </AssistantRuntimeProvider>
  );
}

/** 缓存 bridge URL，避免会话切换时 Provider 短暂卸掉整页（含 TabBar） */
let cachedAguiUrl: string | null = null;

export function AgentRuntimeProvider({
  session,
  children,
}: AgentRuntimeProviderProps) {
  const [aguiUrl, setAguiUrl] = useState<string | null>(
    () => cachedAguiUrl,
  );

  useEffect(() => {
    if (cachedAguiUrl) {
      setAguiUrl(cachedAguiUrl);
      return;
    }
    let cancelled = false;
    void getAguiUrl().then((url) => {
      cachedAguiUrl = url;
      if (!cancelled) {
        setAguiUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // SessionConfig 与 aguiUrl 无关，始终提供，避免 Composer 里 SessionConfigBar 报错
  return (
    <SessionConfigProvider
      tabId={session.tabId}
      threadId={session.threadId}
      agentId={session.agentId}
      cwd={session.cwd}
      agentCommand={session.agentCommand}
      agentSessionId={session.agentSessionId}
    >
      {aguiUrl ? (
        <AgentRuntimeProviderInner session={session} aguiUrl={aguiUrl}>
          {children}
        </AgentRuntimeProviderInner>
      ) : (
        <PendingAguiRuntimeProvider>{children}</PendingAguiRuntimeProvider>
      )}
    </SessionConfigProvider>
  );
}
