import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { AGUI_URL } from "@/config/agents";
import { BridgeHttpAgent } from "@/lib/bridge-agent";

export type SessionConfig = {
  threadId: string;
  cwd: string;
  agentCommand: string[];
};

type AgentRuntimeProviderProps = {
  session: SessionConfig;
  children: React.ReactNode;
};

export function AgentRuntimeProvider({
  session,
  children,
}: AgentRuntimeProviderProps) {
  const agent = useMemo(
    () =>
      new BridgeHttpAgent(
        AGUI_URL,
        { cwd: session.cwd, agentCommand: session.agentCommand },
        session.threadId,
      ),
    [session.threadId, session.cwd, session.agentCommand],
  );

  const runtime = useAgUiRuntime({ agent });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
