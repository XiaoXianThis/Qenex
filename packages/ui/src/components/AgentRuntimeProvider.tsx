import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  getAgentPreset,
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
import { ErrorOverlay } from "@/components/ErrorOverlay";

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

function messageTextLength(message: UIMessage | undefined): number {
  if (!message) return 0;
  return (message.parts ?? []).reduce(
    (length, part) =>
      part.type === "text" && typeof part.text === "string"
        ? length + part.text.length
        : length,
    0,
  );
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
  const setMessagesRef = useRef<
    | ((
        messages:
          | UIMessage[]
          | ((current: UIMessage[]) => UIMessage[]),
      ) => void)
    | null
  >(null);

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
    // Limit React/AUI mirror updates while retaining every append-only delta.
    throttle: 32,
    onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      if (isAbort || isDisconnect || isError) return;
      const finishedMessageId = message.id;
      void listAisdkSessionMessages(sessionId, host)
        .then((persisted) => {
          const canonical = persisted as UIMessage[];
          if (canonical.length === 0) return;
          setMessagesRef.current?.((current) => {
            const currentLast = current.at(-1);
            if (currentLast?.id !== finishedMessageId) return current;
            const canonicalLast = canonical.at(-1);
            if (
              canonicalLast?.role !== "assistant" ||
              messageTextLength(canonicalLast) < messageTextLength(currentLast)
            ) {
              return current;
            }
            return canonical;
          });
        })
        .catch((error) => {
          console.warn("Failed to reconcile completed chat stream:", error);
        });
    },
  });
  setMessagesRef.current = chat.setMessages;
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
    // Inactive keepalive slots receive no children. They must retain their
    // runtime state without mounting a full-height error surface into the page.
    if (children == null) {
      return <PendingRuntimeProvider>{children}</PendingRuntimeProvider>;
    }
    const agent = getAgentPreset(session.agentId);
    return (
      <PendingRuntimeProvider>
        <div className="relative h-full min-h-0">
          {children}
          <ErrorOverlay
            className="top-14"
            title={`${agent.name} 启动失败`}
            message={error}
            detail={
              session.cwd ? (
                <span className="block truncate font-mono" title={session.cwd}>
                  当前路径：{session.cwd}
                </span>
              ) : null
            }
            actions={
              <>
            <button
              type="button"
              className="cursor-pointer rounded-md bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-muted/80"
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
              className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              重试
            </button>
              </>
            }
          />
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
