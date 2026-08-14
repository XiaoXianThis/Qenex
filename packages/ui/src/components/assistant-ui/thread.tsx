"use client";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { SessionConfigBar } from "@/components/SessionConfigBar";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { AgentIcon } from "@/components/AgentIcon";
import { AgentAuthDialog } from "@/components/AgentAuthDialog";
import { ErrorOverlay } from "@/components/ErrorOverlay";
import {
  cn,
  formatBridgeError,
  getAgentPreset,
  isAuthRequiredError,
  authChallengeFromError,
  useLayoutStore,
  useSessionConfig,
  useTabsStore,
} from "@qenex/core";
import { useChatHelpers } from "@/components/ChatHelpersContext";
import { ComposerAutocomplete } from "@/components/assistant-ui/composer-autocomplete";
import { MessageArtifacts } from "@/components/assistant-ui/message-artifacts";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessageByIndexProvider,
  MessagePartPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import type { UIMessage } from "ai";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  KeyRound,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type FC,
  type PropsWithChildren,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

const ChatMessageImage: FC = () => (
  <MessagePartPrimitive.Image
    alt="Chat image"
    loading="eager"
    decoding="async"
    className="aui-message-image my-3 block h-auto max-h-[70vh] max-w-full rounded-xl object-contain first:mt-0 last:mb-0"
  />
);

const MARKDOWN_IMAGE_PATTERN =
  /!\[[^\]]*]\s*(?:\([^)]*\)|\[[^\]]*])|<img\b/i;

const messageContainsImage = (
  parts: readonly { type: string; text?: string }[],
) =>
  parts.some(
    (part) =>
      part.type === "image" ||
      (part.type === "text" &&
        MARKDOWN_IMAGE_PATTERN.test(part.text ?? "")),
  );

const ThreadReasoningGroup: FC<
  PropsWithChildren<{ group: ThreadGroupPart }>
> = ({ group, children }) => {
  const chat = useChatHelpers();
  const chatBusy =
    chat?.status === "submitted" || chat?.status === "streaming";
  const innerRunning = useAuiState((s) =>
    group.indices.some((index) => {
      const part = s.message.parts[index];
      return (
        part?.type === "reasoning" && part.status?.type === "running"
      );
    }),
  );
  const streaming = Boolean(chatBusy && innerRunning);

  return (
    <ReasoningRoot streaming={streaming}>
      <ReasoningTrigger active={streaming} />
      <ReasoningContent aria-busy={streaming}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
};

const ToolSequenceGroup: FC<
  PropsWithChildren<{ group: ThreadGroupPart }>
> = ({ group, children }) => {
  const toolCount = useAuiState((s) =>
    group.indices.reduce(
      (count, index) =>
        count + (s.message.parts[index]?.type === "tool-call" ? 1 : 0),
      0,
    ),
  );
  const active = useAuiState((s) =>
    group.indices.some((index) => {
      const part = s.message.parts[index];
      return (
        part?.type === "tool-call" &&
        (part.status?.type === "running" ||
          part.status?.type === "requires-action")
      );
    }),
  );

  if (toolCount < 2) {
    return <div data-slot="aui_chain-of-thought">{children}</div>;
  }

  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={toolCount} active={active} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

export { ThreadComponentsContext };

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
  return (
    <ThreadComponentsContext.Provider value={components}>
      {null}
    </ThreadComponentsContext.Provider>
  );
};

export const ThreadMessages: FC = () => {
  const chat = useChatHelpers();
  // Primitive fingerprint — never return a new array from useAuiState.
  const threadIdFingerprint = useAuiState((s) =>
    s.thread.messages.map((message) => message.id).join("\n"),
  );
  const threadIds = threadIdFingerprint
    ? threadIdFingerprint.split("\n")
    : [];

  // Drive the list from live useChat messages so sendMessage paints the user
  // bubble in the same turn (true optimism — not a parallel fake bubble).
  if (chat && chat.messages.length > 0) {
    const last = chat.messages.at(-1);
    const optimisticWait =
      (chat.status === "submitted" || chat.status === "streaming") &&
      last?.role === "user";
    return (
      <div
        data-slot="aui_message-group"
        className="mb-14 flex flex-col gap-y-6 text-sm"
      >
        {chat.messages.map((message) => {
          const threadIndex = threadIds.indexOf(message.id);
          if (threadIndex >= 0) {
            return (
              <MessageByIndexProvider key={message.id} index={threadIndex}>
                <ThreadMessage />
              </MessageByIndexProvider>
            );
          }
          if (message.role === "user") {
            return <LiveUserMessage key={message.id} message={message} />;
          }
          return <LiveAssistantFallback key={message.id} message={message} />;
        })}
        {optimisticWait ? (
          <LiveAssistantFallback
            key="optimistic-wait"
            message={OPTIMISTIC_ASSISTANT_MESSAGE}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-slot="aui_message-group"
      className="mb-14 flex flex-col gap-y-6 text-sm empty:hidden"
    >
      <ThreadPrimitive.Messages>
        {() => <ThreadMessage />}
      </ThreadPrimitive.Messages>
    </div>
  );
};

function textFromUiMessage(message: UIMessage): string {
  return (message.parts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof (part as { text?: string }).text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function reasoningFromUiMessage(message: UIMessage): string {
  return (message.parts ?? [])
    .filter(
      (part): part is { type: "reasoning"; text: string } =>
        part.type === "reasoning" &&
        typeof (part as { text?: string }).text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/** True-optimistic user row from useChat before ThreadPrimitive mirrors the id. */
const LiveUserMessage: FC<{ message: UIMessage }> = ({ message }) => {
  const text = textFromUiMessage(message);
  if (!text) return null;
  return (
    <div
      data-slot="aui_user-message-root"
      data-role="user"
      data-testid="live-user-message"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(88px,1fr)_auto] content-start gap-y-2 px-4 duration-150 [&:where(>*)]:col-start-2"
    >
      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-card text-card-foreground rounded-xl px-4 py-2 wrap-break-word whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
};

/** Match AssistantMessage footer reserve so Live → MessageByIndex doesn't jump height. */
const LIVE_ACTION_BAR_HEIGHT = "-mb-7.5 min-h-7.5 pt-1.5";

const OPTIMISTIC_ASSISTANT_MESSAGE: UIMessage = {
  id: "optimistic-wait",
  role: "assistant",
  parts: [],
};

/** Whole-turn waiting caret — not bound to the current text part. */
const TurnStreamingCaret: FC = () => (
  <span
    data-slot="aui_turn-streaming-caret"
    className="aui-turn-caret"
    aria-label="Assistant is working"
  >
    {"●"}
  </span>
);

/** Assistant stub from useChat while ThreadPrimitive catches up / mid-stream. */
const LiveAssistantFallback: FC<{ message: UIMessage }> = ({ message }) => {
  const text = textFromUiMessage(message);
  const reasoning = reasoningFromUiMessage(message);
  const indicator = <TurnStreamingCaret />;

  return (
    <div
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      data-testid="live-assistant-fallback"
      className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-4 leading-relaxed wrap-break-word"
      >
        {reasoning ? (
          <div className="text-muted-foreground mb-2 whitespace-pre-wrap text-xs">
            {reasoning}
          </div>
        ) : null}
        {text ? (
          <div className="whitespace-pre-wrap">{text}</div>
        ) : (
          indicator
        )}
      </div>
      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", LIVE_ACTION_BAR_HEIGHT)}
      />
    </div>
  );
};

/**
 * M1 temporary plain-text list — retired for primary UI in M3.
 * Kept exported for diagnostics / emergency fallback.
 */
export const AisdkThreadMessages: FC = () => {
  const chat = useChatHelpers();
  if (!chat || (chat.messages.length === 0 && !chat.error)) return null;

  return (
    <div
      data-slot="aui_message-group"
      className="mb-14 flex flex-col gap-y-6 px-4 text-sm"
    >
      {chat.messages.map((message) => {
        const texts = message.parts
          .filter(
            (part): part is { type: "text"; text: string } =>
              part.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text)
          .join("\n");
        const isUser = message.role === "user";
        return (
          <div
            key={message.id}
            data-role={message.role}
            className={cn(
              "flex w-full",
              isUser ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 leading-relaxed",
                isUser
                  ? "bg-muted text-foreground"
                  : "text-foreground",
              )}
            >
              {texts || (isUser ? "" : "…")}
            </div>
          </div>
        );
      })}
      {chat.error ? (
        <div className="border-destructive bg-destructive/10 text-destructive rounded-md border p-3 text-sm whitespace-pre-wrap">
          {formatBridgeError(chat.error)}
        </div>
      ) : null}
    </div>
  );
};

/** Live useChat error banner (ThreadPrimitive does not always surface transport errors). */
export const ChatStreamErrorBanner: FC = () => {
  const chat = useChatHelpers();
  const { agentId, retryAfterAuth } = useSessionConfig();
  const [dismissedError, setDismissedError] = useState<unknown>(null);
  const [authOpen, setAuthOpen] = useState(false);
  if (!chat?.error || dismissedError === chat.error) return null;
  const message = formatBridgeError(chat.error);
  const needsAuth =
    isAuthRequiredError(chat.error) || /需要登录|凭证已失效/.test(message);
  const agent = getAgentPreset(agentId);
  return (
    <>
      <ErrorOverlay
        testId="chat-stream-error"
        title={needsAuth ? `${agent.name} 需要登录` : "对话请求失败"}
        message={message}
        onDismiss={() => setDismissedError(chat.error)}
        actions={
          <>
            {needsAuth ? (
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                onClick={() => setAuthOpen(true)}
              >
                <KeyRound className="size-3.5" />
                需要登录
              </button>
            ) : (
              <button
                type="button"
                className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                onClick={() => void chat.regenerate?.()}
              >
                重新生成
              </button>
            )}
            <button
              type="button"
              className="cursor-pointer rounded-md bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-muted/80"
              onClick={() => chat.stop?.()}
            >
              停止
            </button>
          </>
        }
      />
      {needsAuth ? (
        <AgentAuthDialog
          open={authOpen}
          onOpenChange={setAuthOpen}
          agentId={agentId}
          challenge={authChallengeFromError(chat.error, agent.name)}
          onRetry={async () => {
            await retryAfterAuth();
            await chat.regenerate?.();
          }}
        />
      ) : null}
    </>
  );
};

export const SessionConfigErrorOverlay: FC = () => {
  const { config, agentId, retryAfterAuth } = useSessionConfig();
  const agent = getAgentPreset(agentId);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!config.error) setDismissedMessage(null);
  }, [config.error]);

  if (!config.error || config.authChallenge || dismissedMessage === config.error) {
    return null;
  }

  return (
    <ErrorOverlay
      className="right-auto left-3"
      testId="session-config-error"
      title={`${agent.name} 配置失败`}
      message={config.error}
      onDismiss={() => setDismissedMessage(config.error)}
      actions={
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={retrying || config.loading}
          onClick={() => {
            setRetrying(true);
            void retryAfterAuth()
              .catch(() => {
                // The provider updates config.error with the actionable detail.
              })
              .finally(() => setRetrying(false));
          }}
        >
          <RotateCcwIcon className="size-3.5" />
          {retrying ? "重试中…" : "重试"}
        </button>
      }
    />
  );
};

/** Status while waiting on model / tool / Ask approval — avoids “假死”无反馈. */
export const ChatRunStatusBanner: FC = () => {
  const chat = useChatHelpers();
  const threadRunning = useAuiState((s) => s.thread.isRunning);
  const isRunning =
    chat?.status === "submitted" ||
    chat?.status === "streaming" ||
    threadRunning;

  const last = chat?.messages.at(-1);
  const incompleteAssistant =
    Boolean(last) &&
    last!.role === "assistant" &&
    !isRunning &&
    chat?.status === "ready" &&
    !textFromUiMessage(last!) &&
    (reasoningFromUiMessage(last!).length > 0 ||
      (last!.parts ?? []).some((part) => String(part.type).startsWith("tool")));

  if (incompleteAssistant) {
    return (
      <div
        data-testid="chat-run-status"
        className="border-border bg-muted/40 text-foreground mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"
      >
        <span>回复似乎卡住了（常见于网页搜索/工具无结果）。</span>
        <button
          type="button"
          className="text-primary cursor-pointer underline"
          onClick={() => void chat?.regenerate?.()}
        >
          重新生成
        </button>
        <button
          type="button"
          className="text-muted-foreground cursor-pointer underline"
          onClick={() => chat?.stop?.()}
        >
          停止
        </button>
      </div>
    );
  }

  // Normal running: match main — indicator lives in the message (●), no status strip.
  return null;
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

export const ThreadScrollToBottom: FC = () => {
  const layoutEditing = useLayoutStore((s) => s.editMode);
  if (layoutEditing) return null;

  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

export const ThreadWelcome: FC = () => {
  const { agentId } = useSessionConfig();
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const agent = getAgentPreset(agentId);
  const fullText = `和 ${agent.name} 一起构建想象`;
  const [typedText, setTypedText] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setTypedText("");
    setDone(false);
    let index = 0;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const startId = window.setTimeout(() => {
      intervalId = setInterval(() => {
        index += 1;
        setTypedText(fullText.slice(0, index));
        if (index >= fullText.length) {
          if (intervalId) clearInterval(intervalId);
          setDone(true);
        }
      }, 80);
    }, 400);

    return () => {
      window.clearTimeout(startId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [fullText]);

  return (
    <div
      key={activeTabId ?? agentId}
      className="aui-thread-welcome pointer-events-none flex select-none flex-col items-center justify-center gap-4"
    >
      <AgentIcon
        agentId={agent.id}
        className="aui-thread-welcome-icon size-36 opacity-10 select-none"
        draggable={false}
      />
      <p
        className="aui-thread-welcome-typewriter text-base text-muted-foreground/60"
        aria-label={fullText}
      >
        {typedText}
        {!done ? (
          <span className="aui-thread-welcome-dot" aria-hidden />
        ) : null}
      </p>
    </div>
  );
};

export const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-wrap items-center justify-center gap-2 px-4">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors"
        >
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
          <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 empty:hidden" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

export const ThreadComposer: FC = () => {
  const showSessionConfig = useLayoutStore(
    (s) => s.panels.sessionConfigBar.visible,
  );
  const layoutEditing = useLayoutStore((s) => s.editMode);
  const chat = useChatHelpers();
  // Local draft: ComposerPrimitive.Input / unstable_useComposerInput text does not
  // reliably persist under useAISDKRuntime (same finding as next Thread Composer).
  // Attachments still live on the thread composer; send() syncs text then flushes parts.
  const [draft, setDraft] = useState("");

  return (
    <div className="flex w-full flex-col gap-2">
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ThreadComposerBody
          draft={draft}
          setDraft={setDraft}
          chat={chat}
          layoutEditing={layoutEditing}
          showSessionConfig={showSessionConfig}
        />
      </ComposerPrimitive.Root>
    </div>
  );
};

const ThreadComposerBody: FC<{
  draft: string;
  setDraft: (value: string) => void;
  chat: ReturnType<typeof useChatHelpers>;
  layoutEditing: boolean;
  showSessionConfig: boolean;
}> = ({ draft, setDraft, chat, layoutEditing, showSessionConfig }) => {
  const aui = useAui();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentCount = useAuiState((s) => s.composer.attachments.length);
  const threadRunning = useAuiState((s) => s.thread.isRunning);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    let lastWidth = el.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const width = el.getBoundingClientRect().width;
      if (width === lastWidth) return;
      lastWidth = width;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draft]);

  const isRunning =
    chat?.status === "submitted" ||
    chat?.status === "streaming" ||
    threadRunning;
  const inputDisabled = layoutEditing || !chat;
  const canSend =
    Boolean(chat) &&
    !isRunning &&
    !layoutEditing &&
    (draft.trim().length > 0 || attachmentCount > 0);

  const sendDraft = () => {
    if (!canSend || !chat) return;
    const text = draft;
    const trimmed = text.trim();

    // Text-only: send via useChat for immediate optimistic user message.
    // Attachment path still uses composer.send() so adapter parts are included.
    if (attachmentCount === 0) {
      if (!trimmed) return;
      setDraft("");
      void chat.sendMessage({ text: trimmed });
      return;
    }

    const composer = aui.composer();
    composer.setText(text);
    setDraft("");
    composer.send();
  };

  return (
    <ComposerPrimitive.AttachmentDropzone asChild disabled={layoutEditing}>
      <div
        data-slot="aui_composer-shell"
        className="border-foreground/25 data-[dragging=true]:border-ring focus-within:border-foreground/25 flex w-full flex-col gap-1.5 rounded-(--composer-radius) border-[0.25px] bg-(--composer-bg) p-(--composer-padding) shadow-(--composer-shadow) transition-colors data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))] [[data-composer-overlay]_&]:bg-background/55 [[data-composer-overlay]_&]:backdrop-blur-xl [[data-composer-overlay]_&]:supports-backdrop-filter:bg-background/40"
      >
        <div className="flex min-h-8 flex-col gap-1">
          <ComposerAttachments />
          <ComposerAutocomplete value={draft} onChange={setDraft}>
            <textarea
              ref={inputRef}
              placeholder="发消息… 输入 @ 引用文件"
              className="aui-composer-input caret-primary placeholder:text-foreground/50 max-h-[calc(12lh+0.5rem)] min-h-8 w-full resize-none overflow-y-auto bg-transparent px-2.5 py-1 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              rows={1}
              autoFocus={!layoutEditing}
              enterKeyHint="send"
              aria-label="Message input"
              disabled={inputDisabled}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  if (e.defaultPrevented) return;
                  e.preventDefault();
                  sendDraft();
                }
              }}
            />
          </ComposerAutocomplete>
        </div>
        <div className="aui-composer-action-wrapper flex items-center gap-2 px-0.5">
          {showSessionConfig && !layoutEditing ? (
            <SessionConfigBar
              className="px-0"
              trailing={
                <>
                  <ComposerAddAttachment />
                  <ComposerSendActions
                    canSend={canSend}
                    isRunning={Boolean(isRunning)}
                    onSend={sendDraft}
                    onStop={() => chat?.stop()}
                  />
                </>
              }
            />
          ) : (
            <div className="ms-auto flex items-center gap-2">
              <ComposerAddAttachment />
              <ComposerSendActions
                canSend={canSend}
                isRunning={Boolean(isRunning)}
                onSend={sendDraft}
                onStop={() => chat?.stop()}
              />
            </div>
          )}
        </div>
      </div>
    </ComposerPrimitive.AttachmentDropzone>
  );
};

const ComposerSendActions: FC<{
  canSend: boolean;
  isRunning: boolean;
  onSend: () => void;
  onStop: () => void;
}> = ({ canSend, isRunning, onSend, onStop }) => {
  if (isRunning) {
    return (
      <TooltipIconButton
        tooltip="Stop"
        side="bottom"
        type="button"
        variant="default"
        size="icon"
        className="aui-composer-cancel size-6 rounded-full"
        aria-label="Stop generating"
        onClick={onStop}
      >
        <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
      </TooltipIconButton>
    );
  }

  return (
    <TooltipIconButton
      tooltip="Send message"
      side="bottom"
      type="button"
      variant="default"
      size="icon"
      className="aui-composer-send size-6 rounded-full"
      aria-label="Send message"
      disabled={!canSend}
      onClick={onSend}
    >
      <ArrowUpIcon className="aui-composer-send-icon size-4" />
    </TooltipIconButton>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessageArtifacts: FC = () => {
  const metadata = useAuiState((s) => {
    const message = s.message as { metadata?: unknown; content?: unknown };
    return message.metadata ?? null;
  });
  if (!metadata) return null;
  return <MessageArtifacts metadata={metadata} />;
};

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ReasoningGroup,
  } = useContext(ThreadComponentsContext);
  const isLastMessage = useAuiState(
    (s) => s.thread.messages.at(-1)?.id === s.message.id,
  );
  const containsImage = useAuiState((s) =>
    messageContainsImage(s.message.parts),
  );

  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        // Keep the #4104 optimization for text-only messages. Image messages
        // need eager layout so their real height is known before scrolling in.
        className={cn(
          "text-foreground px-4 leading-relaxed wrap-break-word",
          !containsImage &&
            !isLastMessage &&
            "[contain-intrinsic-size:auto_24px] [content-visibility:auto]",
        )}
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-chainOfThought", "group-reasoning"],
            "tool-call": ["group-chainOfThought"],
            "standalone-tool-call": [],
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return (
                  <ToolSequenceGroup group={part}>{children}</ToolSequenceGroup>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                return (
                  <ThreadReasoningGroup group={part}>
                    {children}
                  </ThreadReasoningGroup>
                );
              }
              case "text":
                return <MarkdownText />;
              case "image":
                return <ChatMessageImage />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />;
              case "data":
                return part.dataRendererUI;
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="animate-pulse font-sans"
                    aria-label="Assistant is working"
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <AssistantMessageArtifacts />
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  const containsImage = useAuiState((s) =>
    messageContainsImage(s.message.parts),
  );

  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className={cn(
        "fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(88px,1fr)_auto] content-start gap-y-2 px-4 duration-150 [&:where(>*)]:col-start-2",
        !containsImage &&
          "[contain-intrinsic-size:auto_60px] [content-visibility:auto]",
      )}
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-card text-card-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts
            components={{ Image: ChatMessageImage }}
          />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-row items-center gap-0.5"
    >
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="更多"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
        >
          <ActionBarPrimitive.Edit asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <PencilIcon className="size-4" />
              编辑并重发
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.Edit>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-4"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg)">
        <ComposerAttachments />
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-12 w-full resize-none bg-transparent px-4 pt-2 pb-1 text-sm outline-none"
          autoFocus
        />
        <EditComposerFooter />
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

/** Must render under ComposerPrimitive.Root. */
const EditComposerFooter: FC = () => {
  return (
    <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
      <ComposerPrimitive.Cancel asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3.5"
        >
          Cancel
        </Button>
      </ComposerPrimitive.Cancel>
      <ComposerPrimitive.Send asChild>
        <Button size="sm" className="h-8 rounded-full px-3.5">
          Update
        </Button>
      </ComposerPrimitive.Send>
    </div>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
