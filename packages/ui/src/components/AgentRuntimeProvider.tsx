import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useAISDKRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  SessionConfigProvider,
  approvalModeFromAutoAllow,
  createComposerAttachmentAdapter,
  ensureAisdkSession,
  formatBridgeError,
  getAisdkSession,
  invalidateSessionBoot,
  isAisdkSessionId,
  listAisdkSessionMessages,
  tabsActions,
  useApprovalPrefsStore,
  useHost,
  type RuntimeSessionConfig,
} from "@qenex/core";
import { ChatHelpersProvider } from "@/components/ChatHelpersContext";
import { ApprovalPollBridge } from "@/components/ApprovalPollBridge";

type AgentRuntimeProviderProps = {
  session: RuntimeSessionConfig;
  children: React.ReactNode;
};

const PENDING_ADAPTER: ChatModelAdapter = {
  async *run() {
    // session 创建完成前的占位 runtime
  },
};

function PendingRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useLocalRuntime(PENDING_ADAPTER);
  return (
    <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
  );
}

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

function AisdkRuntimeInner({
  session,
  sessionId,
  initialMessages,
  children,
}: {
  session: RuntimeSessionConfig;
  sessionId: string;
  initialMessages: UIMessage[];
  children: ReactNode;
}) {
  const host = useHost();
  const autoAllow = useApprovalPrefsStore((s) => s.autoAllow);
  const approvalMode = approvalModeFromAutoAllow(autoAllow);

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

  // Prefer useChat + useAISDKRuntime so Composer stays editable (see next chat-runtime).
  const chat = useChat({
    id: sessionId,
    messages: initialMessages,
    transport,
  });
  const attachmentAdapter = useMemo(() => createComposerAttachmentAdapter(), []);
  const runtime = useAISDKRuntime(chat, {
    adapters: { attachments: attachmentAdapter },
  });

  useEffect(() => {
    if (chat.messages.length > 0) {
      tabsActions.markTabHasChatContent(session.tabId);
    }
  }, [chat.messages.length, session.tabId]);

  // OpenCode / AI SDK can leave the final text part as state:"streaming" after the
  // HTTP stream closes (useChat.status → ready). Normalize so UIs that key off
  // part.state don't look mid-generation forever.
  useEffect(() => {
    if (chat.status !== "ready") return;
    const needsFinalize = chat.messages.some(
      (message) =>
        message.role === "assistant" &&
        (message.parts ?? []).some(
          (part) => part.type === "text" && part.state === "streaming",
        ),
    );
    if (!needsFinalize) return;
    chat.setMessages((messages) =>
      messages.map((message) => {
        if (message.role !== "assistant") return message;
        let changed = false;
        const parts = (message.parts ?? []).map((part) => {
          if (part.type === "text" && part.state === "streaming") {
            changed = true;
            return { ...part, state: "done" as const };
          }
          return part;
        });
        return changed ? { ...message, parts } : message;
      }),
    );
  }, [chat.status, chat.messages, chat.setMessages]);

  useEffect(() => {
    if (session.shouldLoadHistory) {
      tabsActions.clearHistoryLoad(session.tabId);
    }
  }, [session.shouldLoadHistory, session.tabId]);

  return (
    <ChatHelpersProvider chat={chat}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ApprovalPollBridge sessionId={sessionId} />
        {children}
      </AssistantRuntimeProvider>
    </ChatHelpersProvider>
  );
}

function SessionBootstrap({
  session,
  children,
}: {
  session: RuntimeSessionConfig;
  children: ReactNode;
}) {
  const host = useHost();
  const [boot, setBoot] = useState<{
    sessionId: string;
    messages: UIMessage[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setBoot(null);
    setError(null);
    tabsActions.setAgentLoading(session.tabId, true);

        // Retry must force a fresh POST /api/sessions.
    if (retryNonce > 0) {
      invalidateSessionBoot(session.tabId, session.cwd, session.agentId);
    }

    void (async () => {
      try {
        // Soft reload: reuse Bridge session still in SQLite / memory.
        if (retryNonce === 0 && isAisdkSessionId(session.threadId)) {
          const existing = await getAisdkSession(session.threadId, host);
          if (cancelled) return;
          if (existing) {
            let messages: UIMessage[] = [];
            try {
              messages = (await listAisdkSessionMessages(
                existing.sessionId,
                host,
              )) as UIMessage[];
            } catch (err) {
              console.warn("Failed to load session history:", err);
            }
            if (cancelled) return;
            tabsActions.bindBridgeSession(
              session.tabId,
              existing.sessionId,
              existing.title,
            );
            if (messages.length > 0) {
              tabsActions.markTabHasChatContent(session.tabId);
            }
            setBoot({ sessionId: existing.sessionId, messages });
            return;
          }
        }

        // Shared promise: Strict Mode remount does not double-create.
        const info = await ensureAisdkSession(session.tabId, session.cwd, host, {
          agentId: session.agentId,
          agentCommand: session.agentCommand,
        });
        if (cancelled) return;

        let messages: UIMessage[] = [];
        try {
          messages = (await listAisdkSessionMessages(
            info.sessionId,
            host,
          )) as UIMessage[];
        } catch (err) {
          console.warn("Failed to load session history:", err);
        }
        if (cancelled) return;

        tabsActions.bindBridgeSession(
          session.tabId,
          info.sessionId,
          info.title,
        );
        if (messages.length > 0) {
          tabsActions.markTabHasChatContent(session.tabId);
        }
        setBoot({ sessionId: info.sessionId, messages });
      } catch (err) {
        if (cancelled) return;
        setError(formatBridgeError(err));
        tabsActions.setAgentLoading(session.tabId, false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    host,
    session.tabId,
    session.cwd,
    session.threadId,
    session.agentId,
    session.agentCommand,
    retryNonce,
  ]);

  if (error) {
    return (
      <PendingRuntimeProvider>
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-destructive max-w-md text-sm whitespace-pre-wrap">
            {error}
          </p>
          {session.cwd ? (
            <p
              className="text-muted-foreground max-w-md truncate font-mono text-xs"
              title={session.cwd}
            >
              当前路径：{session.cwd}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="border-border hover:bg-muted cursor-pointer rounded-md border px-3 py-1.5 text-sm"
              onClick={() => {
                void (async () => {
                  const picked = await host.pickWorkspace();
                  if (!picked?.trim()) return;
                  tabsActions.setTabCwd(session.tabId, picked.trim());
                  setRetryNonce((n) => n + 1);
                })();
              }}
            >
              选择工作目录
            </button>
            <button
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer rounded-md px-3 py-1.5 text-sm"
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              重试
            </button>
          </div>
          {children}
        </div>
      </PendingRuntimeProvider>
    );
  }

  if (!boot) {
    return <PendingRuntimeProvider>{children}</PendingRuntimeProvider>;
  }

  return (
    <AisdkRuntimeInner
      session={session}
      sessionId={boot.sessionId}
      initialMessages={boot.messages}
    >
      {children}
    </AisdkRuntimeInner>
  );
}

/**
 * M1+: AI SDK UIMessage runtime (no AG-UI).
 * M2: chat body includes approvalMode; ApprovalPollBridge drives Ask cards.
 * M4: loads Bridge SQLite history into useChat initial messages.
 */
export function AgentRuntimeProvider({
  session,
  children,
}: AgentRuntimeProviderProps) {
  return (
    <SessionConfigProvider
      tabId={session.tabId}
      threadId={session.threadId}
      agentId={session.agentId}
      cwd={session.cwd}
      agentCommand={session.agentCommand}
      agentSessionId={session.agentSessionId}
    >
      <SessionBootstrap session={session}>{children}</SessionBootstrap>
    </SessionConfigProvider>
  );
}
