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
  authChallengeFromError,
  createComposerAttachmentAdapter,
  ensureAisdkSession,
  formatBridgeError,
  getAgentPreset,
  getAisdkSession,
  invalidateSessionBoot,
  isAisdkSessionId,
  isAuthRequiredError,
  listAisdkSessionMessages,
  tabsActions,
  useApprovalPrefsStore,
  useHost,
  warmupAisdkSession,
  type AuthChallenge,
  type RuntimeSessionConfig,
} from "@qenex/core";
import { ChatHelpersProvider } from "@/components/ChatHelpersContext";
import { ApprovalPollBridge } from "@/components/ApprovalPollBridge";
import { AgentAuthDialog } from "@/components/AgentAuthDialog";
import { ErrorOverlay } from "@/components/ErrorOverlay";
import { KeyRound, Loader2 } from "lucide-react";

type AgentRuntimeProviderProps = {
  session: RuntimeSessionConfig;
  children: React.ReactNode;
  /** Visible tab only. Inactive keepalive slots stay mounted but skip poll/warmup. */
  isActive?: boolean;
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

/** Only refetch persisted history when the finished stream looks empty/broken. */
function shouldReconcileCompletedStream(message: UIMessage): boolean {
  if (message.role !== "assistant") return true;
  return messageTextLength(message) === 0;
}

function AisdkRuntimeInner({
  session,
  sessionId,
  initialMessages,
  isActive,
  children,
}: {
  session: RuntimeSessionConfig;
  sessionId: string;
  initialMessages: UIMessage[];
  isActive: boolean;
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
      if (!shouldReconcileCompletedStream(message)) return;
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
        <ApprovalPollBridge sessionId={sessionId} isActive={isActive} />
        {children}
      </AssistantRuntimeProvider>
    </ChatHelpersProvider>
  );
}

function SessionBootstrap({
  session,
  isActive,
  children,
}: {
  session: RuntimeSessionConfig;
  isActive: boolean;
  children: ReactNode;
}) {
  const host = useHost();
  const [boot, setBoot] = useState<{
    sessionId: string;
    messages: UIMessage[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authChallenge, setAuthChallenge] = useState<AuthChallenge | null>(
    null,
  );
  const [authOpen, setAuthOpen] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [bootHint, setBootHint] = useState(false);
  const retryWaiterRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const bootedSessionIdRef = useRef<string | null>(null);
  const pendingWarmupSessionIdRef = useRef<string | null>(null);

  const settleRetry = (error?: Error) => {
    const waiter = retryWaiterRef.current;
    retryWaiterRef.current = null;
    if (!waiter) return;
    if (error) waiter.reject(error);
    else waiter.resolve();
  };

  useEffect(() => {
    let cancelled = false;

    if (retryNonce > 0) {
      bootedSessionIdRef.current = null;
      pendingWarmupSessionIdRef.current = null;
      invalidateSessionBoot(session.tabId, session.cwd, session.agentId);
    }

    // bindBridgeSession updates threadId; don't re-bootstrap / GET messages.
    if (
      retryNonce === 0 &&
      isAisdkSessionId(session.threadId) &&
      bootedSessionIdRef.current === session.threadId
    ) {
      return;
    }

    setBoot(null);
    setError(null);
    tabsActions.setAgentLoading(session.tabId, true);

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
            bootedSessionIdRef.current = existing.sessionId;
            pendingWarmupSessionIdRef.current = existing.sessionId;
            setAuthChallenge(null);
            setAuthOpen(false);
            setBoot({ sessionId: existing.sessionId, messages });
            settleRetry();
            return;
          }
        }

        // Shared promise: Strict Mode remount does not double-create.
        const info = await ensureAisdkSession(session.tabId, session.cwd, host, {
          agentId: session.agentId,
          agentCommand: session.agentCommand,
        });
        if (cancelled) return;

        tabsActions.bindBridgeSession(
          session.tabId,
          info.sessionId,
          info.title,
        );
        bootedSessionIdRef.current = info.sessionId;
        setAuthChallenge(null);
        setAuthOpen(false);
        setBoot({ sessionId: info.sessionId, messages: [] });
        settleRetry();
      } catch (err) {
        if (cancelled) return;
        tabsActions.setAgentLoading(session.tabId, false);
        if (isAuthRequiredError(err)) {
          const agent = getAgentPreset(session.agentId);
          setAuthChallenge(authChallengeFromError(err, agent.name));
          setAuthOpen(true);
          setError(null);
          settleRetry(new Error("仍需登录：请在浏览器完成授权后再试"));
          return;
        }
        setAuthChallenge(null);
        setError(formatBridgeError(err));
        settleRetry(
          err instanceof Error ? err : new Error(formatBridgeError(err)),
        );
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

  useEffect(() => {
    if (!isActive) return;
    const sessionId = pendingWarmupSessionIdRef.current;
    if (!sessionId || boot?.sessionId !== sessionId) return;
    pendingWarmupSessionIdRef.current = null;
    void warmupAisdkSession(sessionId, host).catch((error) => {
      console.warn("Failed to warmup Bridge session:", error);
    });
  }, [isActive, boot, host]);

  useEffect(() => {
    if (boot || error || authChallenge) {
      setBootHint(false);
      return;
    }
    const timer = window.setTimeout(() => setBootHint(true), 1500);
    return () => window.clearTimeout(timer);
  }, [boot, error, authChallenge, retryNonce]);

  const retrySession = () => {
    return new Promise<void>((resolve, reject) => {
      retryWaiterRef.current = { resolve, reject };
      setRetryNonce((n) => n + 1);
    });
  };

  if (authChallenge) {
    if (children == null) {
      return <PendingRuntimeProvider>{children}</PendingRuntimeProvider>;
    }
    return (
      <PendingRuntimeProvider>
        <div className="relative h-full min-h-0">
          {children}
          {!authOpen ? (
            <button
              type="button"
              className="absolute top-14 right-3 z-50 inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground shadow-sm hover:bg-muted"
              onClick={() => setAuthOpen(true)}
            >
              <KeyRound className="size-3.5" />
              需要登录
            </button>
          ) : null}
          <AgentAuthDialog
            open={authOpen}
            onOpenChange={setAuthOpen}
            agentId={session.agentId}
            challenge={authChallenge}
            onRetry={retrySession}
          />
        </div>
      </PendingRuntimeProvider>
    );
  }

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
    if (children == null) {
      return <PendingRuntimeProvider>{children}</PendingRuntimeProvider>;
    }
    return (
      <PendingRuntimeProvider>
        <div className="relative h-full min-h-0">
          {children}
          {bootHint ? (
            <aside
              role="status"
              className="pointer-events-none absolute top-14 right-3 z-50 w-[min(22rem,calc(100%-1.5rem))] rounded-lg border border-border bg-background/96 p-3 text-sm shadow-xl backdrop-blur-md"
            >
              <div className="flex items-start gap-2.5">
                <Loader2
                  className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">正在启动</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    若系统打开了账号登录页，请在浏览器完成授权。完成后会自动继续。
                  </p>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </PendingRuntimeProvider>
    );
  }

  return (
    <AisdkRuntimeInner
      session={session}
      sessionId={boot.sessionId}
      initialMessages={boot.messages}
      isActive={isActive}
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
  isActive = true,
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
      <SessionBootstrap session={session} isActive={isActive}>
        {children}
      </SessionBootstrap>
    </SessionConfigProvider>
  );
}
