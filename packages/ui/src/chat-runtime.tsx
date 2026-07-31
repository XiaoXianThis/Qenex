import { useMemo, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useAISDKRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";
import { useQenexHost } from "./host.tsx";
import { Thread } from "./thread.tsx";
import {
  loadApprovalMode,
  saveApprovalMode,
  type ApprovalMode,
} from "@qenex/core";

function resolveChatUrl(base: string, input: string | URL | Request): string {
  const normalizedBase = base.replace(/\/$/, "");
  if (typeof input !== "string") {
    if (input instanceof URL) return input.toString();
    return input.url;
  }
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  const path = input.startsWith("/") ? input : `/${input}`;
  return normalizedBase ? `${normalizedBase}${path}` : path;
}

export function ChatRuntime({ sessionId }: { sessionId: string }) {
  const host = useQenexHost();
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() =>
    loadApprovalMode(host),
  );

  function changeApprovalMode(mode: ApprovalMode) {
    saveApprovalMode(host, mode);
    setApprovalMode(mode);
  }

  const transport = useMemo(() => {
    return new AssistantChatTransport({
      api: "/api/chat",
      body: { sessionId, approvalMode },
      headers: { "x-qenex-session-id": sessionId },
      fetch: (async (input, init) => {
        const base = await host.getBridgeBaseUrl();
        const url = resolveChatUrl(base, input);
        return host.fetch(url, init);
      }) as typeof fetch,
    });
  }, [approvalMode, host, sessionId]);

  // Prefer useChat + useAISDKRuntime over useChatRuntime so the thread
  // composer stays in editing mode (isEditing=true). useChatRuntime's remote
  // thread-list nesting was leaving a NoOp composer (isEditing=false), which
  // makes ComposerPrimitive.Input a controlled empty string that rejects typing.
  const chat = useChat({ transport });
  const runtime = useAISDKRuntime(chat);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread
        sessionId={sessionId}
        approvalMode={approvalMode}
        onApprovalModeChange={changeApprovalMode}
      />
    </AssistantRuntimeProvider>
  );
}
