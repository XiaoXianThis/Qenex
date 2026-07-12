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
import {
  cn,
  getAgentPreset,
  rewindTask,
  useLayoutStore,
  useSessionConfig,
  useTabsStore,
} from "@qenex/core";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
  useComposerRuntime,
  useThreadRuntime,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type FC,
  type PropsWithChildren,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

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
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
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
  return (
    <div
      data-slot="aui_message-group"
      className="mb-14 flex flex-col gap-y-6 empty:hidden"
    >
      <ThreadPrimitive.Messages>
        {() => <ThreadMessage />}
      </ThreadPrimitive.Messages>
    </div>
  );
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
  const { config, agentId, retryAfterAuth } = useSessionConfig();
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const agent = getAgentPreset(agentId);
  const fullText = `和 ${agent.name} 一起构建想象`;
  const [typedText, setTypedText] = useState("");
  const [done, setDone] = useState(false);
  const [retrying, setRetrying] = useState(false);

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

  if (config.error && !config.authChallenge) {
    return (
      <div
        key={activeTabId ?? agentId}
        className="aui-thread-welcome flex max-w-lg flex-col items-center justify-center gap-4 px-4"
      >
        <AgentIcon
          agentId={agent.id}
          className="aui-thread-welcome-icon size-24 opacity-20 select-none"
          draggable={false}
        />
        <div className="space-y-2 text-center">
          <p className="text-destructive text-sm font-medium">
            {agent.name} 启动失败
          </p>
          <pre className="border-destructive/20 bg-destructive/5 text-muted-foreground max-h-40 overflow-auto rounded-md border p-3 text-left text-[11px] leading-relaxed break-words whitespace-pre-wrap">
            {config.error}
          </pre>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={retrying || config.loading}
          onClick={() => {
            setRetrying(true);
            void retryAfterAuth()
              .catch(() => {
                // bootstrap already wrote config.error
              })
              .finally(() => setRetrying(false));
          }}
        >
          <RotateCcwIcon className="size-3.5" />
          {retrying ? "重试中…" : "重试启动"}
        </Button>
      </div>
    );
  }

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

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild disabled={layoutEditing}>
        <div
          data-slot="aui_composer-shell"
          className="border-border/60 data-[dragging=true]:border-ring focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-(--composer-shadow) transition-colors data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]"
        >
          <div className="flex min-h-10 flex-col gap-1">
            <ComposerAttachments />
            <ComposerPrimitive.Input
              placeholder="Send a message..."
              className="aui-composer-input caret-primary placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
              rows={1}
              autoFocus={!layoutEditing}
              enterKeyHint="send"
              aria-label="Message input"
            />
          </div>
          <div className="aui-composer-action-wrapper flex items-center gap-2 px-0.5">
            {showSessionConfig && !layoutEditing ? (
              <SessionConfigBar
                className="px-0"
                trailing={
                  <>
                    <ComposerAddAttachment />
                    <ComposerSendActions />
                  </>
                }
              />
            ) : (
              <div className="ms-auto flex items-center gap-2">
                <ComposerAddAttachment />
                <ComposerSendActions />
              </div>
            )}
          </div>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerSendActions: FC = () => {
  return (
    <>
      <AuiIf condition={(s) => s.thread.capabilities.dictation}>
        <AuiIf condition={(s) => s.composer.dictation == null}>
          <ComposerPrimitive.Dictate asChild>
            <TooltipIconButton
              tooltip="Voice input"
              side="bottom"
              type="button"
              variant="ghost"
              size="icon"
              className="aui-composer-dictate size-7 rounded-full"
              aria-label="Start voice input"
            >
              <MicIcon className="aui-composer-dictate-icon size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Dictate>
        </AuiIf>
        <AuiIf condition={(s) => s.composer.dictation != null}>
          <ComposerPrimitive.StopDictation asChild>
            <TooltipIconButton
              tooltip="Stop dictation"
              side="bottom"
              type="button"
              variant="ghost"
              size="icon"
              className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
              aria-label="Stop voice input"
            >
              <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
            </TooltipIconButton>
          </ComposerPrimitive.StopDictation>
        </AuiIf>
      </AuiIf>
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-send size-7 rounded-full"
            aria-label="Send message"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-7 rounded-full"
            aria-label="Stop generating"
          >
            <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </>
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

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
  } = useContext(ThreadComponentsContext);

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
        // [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
        className="text-foreground px-2 leading-relaxed wrap-break-word [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-chainOfThought", "group-reasoning"],
            "tool-call": ["group-chainOfThought", "group-tool"],
            "standalone-tool-call": [],
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <ToolGroupRoot variant="ghost">
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status?.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                const running = part.status?.type === "running";
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText />;
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
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-card text-card-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts />
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
  const threadRuntime = useThreadRuntime();
  const messageId = useAuiState((s) => s.message.id);
  const messageContent = useAuiState((s) => s.message.content);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const taskId = tabs.find((t) => t.id === activeTabId)?.taskId;
  const [busy, setBusy] = useState(false);

  const handleUndo = async () => {
    if (!taskId || busy) return;
    if (
      !window.confirm(
        "撤销到这条消息发送前？之后的对话与文件改动都会丢弃。",
      )
    ) {
      return;
    }

    const exported = threadRuntime.export();
    const idx = exported.messages.findIndex((m) => m.message.id === messageId);
    if (idx < 0) return;

    const userMessageIndex =
      exported.messages
        .slice(0, idx + 1)
        .filter((m) => m.message.role === "user").length - 1;
    if (userMessageIndex < 0) return;

    const textParts = Array.isArray(messageContent)
      ? messageContent
          .filter(
            (p): p is { type: "text"; text: string } =>
              p.type === "text" && typeof p.text === "string",
          )
          .map((p) => p.text)
      : [];
    const restoreText = textParts.join("\n");

    setBusy(true);
    try {
      await rewindTask(taskId, { userMessageIndex });
      const kept = exported.messages.slice(0, idx);
      const remapped = kept.map((item, i) => ({
        message: item.message,
        parentId: i === 0 ? null : kept[i - 1]!.message.id,
      }));
      threadRuntime.import({
        messages: remapped,
        headId: remapped.at(-1)?.message.id ?? null,
      });
      if (restoreText) {
        threadRuntime.composer.setText(restoreText);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end gap-0.5"
    >
      <TooltipIconButton
        tooltip="撤销"
        className="aui-user-action-undo"
        disabled={busy || !taskId}
        onClick={() => void handleUndo()}
      >
        <RotateCcwIcon />
      </TooltipIconButton>
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
      className="flex flex-col px-2"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg)">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <EditComposerFooter />
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

/** Must render under ComposerPrimitive.Root so useComposerRuntime binds to the edit composer. */
const EditComposerFooter: FC = () => {
  const threadRuntime = useThreadRuntime();
  const composerRuntime = useComposerRuntime();
  const messageId = useAuiState((s) => s.message.id);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const taskId = tabs.find((t) => t.id === activeTabId)?.taskId;
  const [busy, setBusy] = useState(false);

  const handleUpdate = async () => {
    if (busy) return;

    const exported = threadRuntime.export();
    const idx = exported.messages.findIndex((m) => m.message.id === messageId);
    if (idx < 0) return;

    const userMessageIndex =
      exported.messages
        .slice(0, idx + 1)
        .filter((m) => m.message.role === "user").length - 1;

    setBusy(true);
    try {
      if (taskId && userMessageIndex >= 0) {
        await rewindTask(taskId, { userMessageIndex });
      }
      composerRuntime.send();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
      <ComposerPrimitive.Cancel asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3.5"
          disabled={busy}
        >
          Cancel
        </Button>
      </ComposerPrimitive.Cancel>
      <Button
        size="sm"
        className="h-8 rounded-full px-3.5"
        disabled={busy}
        onClick={() => void handleUpdate()}
      >
        Update
      </Button>
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
