import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { useAISDKChat } from "@assistant-ui/react-ai-sdk";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  listPendingApprovals,
  respondToApproval,
  formatBridgeError,
  type ApprovalMode,
  type ApprovalOption,
  type PendingApproval,
} from "@qenex/core";
import { useQenexHost } from "./host.tsx";
import { MessageArtifacts } from "./message-artifacts.tsx";

function rejectOption(options: ApprovalOption[]): ApprovalOption | undefined {
  return options.find((option) => /^reject/i.test(option.kind ?? "")) ??
    options.find((option) =>
      !option.kind &&
      /reject|deny|cancel|no/i.test(`${option.optionId} ${option.name}`),
    );
}

function allowOptions(options: ApprovalOption[]): ApprovalOption[] {
  return options.filter(
    (option) =>
      /^allow/i.test(option.kind ?? "") ||
      (!option.kind &&
        (/allow|approve|yes/i.test(`${option.optionId} ${option.name}`) ||
          /^(once|always)$/i.test(option.optionId))),
  );
}

function ApprovalCard({
  approval,
  busy,
  onDecide,
}: {
  approval: PendingApproval;
  busy: boolean;
  onDecide: (optionId: string) => void;
}) {
  const reject = rejectOption(approval.options);
  const allow = allowOptions(approval.options);
  const input = approval.toolCall.rawInput;
  const inputText =
    input === undefined
      ? ""
      : typeof input === "string"
        ? input
        : JSON.stringify(input, null, 2);

  return (
    <section className="qenex-approval" aria-live="polite">
      <div className="qenex-approval-kicker">需要审批</div>
      <div className="qenex-approval-title">
        {approval.toolCall.title || approval.toolCall.kind || "敏感操作"}
      </div>
      {approval.toolCall.locations?.length ? (
        <div className="qenex-approval-paths">
          {approval.toolCall.locations.map((location, index) => (
            <code key={`${location.path}-${index}`}>{location.path}</code>
          ))}
        </div>
      ) : null}
      {inputText ? <pre className="qenex-approval-input">{inputText}</pre> : null}
      <div className="qenex-approval-actions">
        {reject ? (
          <button
            type="button"
            className="qenex-btn danger-outline"
            disabled={busy}
            onClick={() => onDecide(reject.optionId)}
          >
            拒绝
          </button>
        ) : null}
        {allow.map((option) => (
          <button
            type="button"
            className="qenex-btn primary"
            disabled={busy}
            key={option.optionId}
            onClick={() => onDecide(option.optionId)}
          >
            {option.kind === "allow_always" ? "本次会话始终允许" : "批准"}
          </button>
        ))}
      </div>
    </section>
  );
}

function ApprovalPanel({ sessionId }: { sessionId: string }) {
  const host = useQenexHost();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await listPendingApprovals(host, sessionId);
        if (active) {
          setApprovals(next);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) timer = setTimeout(poll, 350);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [host, sessionId]);

  async function decide(approval: PendingApproval, optionId: string) {
    setDeciding(approval.approvalId);
    setError(null);
    try {
      await respondToApproval(
        host,
        sessionId,
        approval.approvalId,
        optionId,
      );
      setApprovals((current) =>
        current.filter((item) => item.approvalId !== approval.approvalId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeciding(null);
    }
  }

  if (!approvals.length && !error) return null;
  return (
    <div className="qenex-approval-panel">
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.approvalId}
          approval={approval}
          busy={deciding === approval.approvalId}
          onDecide={(optionId) => void decide(approval, optionId)}
        />
      ))}
      {error ? <p className="qenex-error">审批状态同步失败：{error}</p> : null}
    </div>
  );
}

function ToolFallback({
  toolName,
  argsText,
  result,
}: {
  toolName?: string;
  argsText?: string;
  result?: unknown;
}) {
  return (
    <div className="qenex-tool">
      <div className="qenex-tool-title">Tool · {toolName ?? "unknown"}</div>
      {argsText ? <pre className="qenex-tool-args">{argsText}</pre> : null}
      {result !== undefined ? (
        <pre className="qenex-tool-result">
          {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function textFromParts(
  parts: Array<{ type: string; text?: string }> | undefined,
): string {
  if (!parts) return "";
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function AssistantParts({
  parts,
}: {
  parts: Array<{ type: string; text?: string; toolName?: string; [key: string]: unknown }>;
}): ReactNode {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text" && typeof part.text === "string") {
          return (
            <div key={i} className="qenex-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {part.text}
              </ReactMarkdown>
            </div>
          );
        }
        if (part.type.startsWith("tool-")) {
          return (
            <ToolFallback
              key={i}
              toolName={
                typeof part.toolName === "string" ? part.toolName : part.type
              }
              argsText={
                "input" in part ? JSON.stringify(part.input, null, 2) : undefined
              }
              result={"output" in part ? part.output : undefined}
            />
          );
        }
        return null;
      })}
    </>
  );
}

/**
 * Local-controlled composer.
 *
 * Assistant-UI ComposerPrimitive.Input is store-controlled via composer.setText.
 * With useChat + useAISDKRuntime that path does not persist text, so typing
 * appears impossible. Drive the textarea with React state and send via useChat.
 */
function Composer({
  approvalMode,
  onApprovalModeChange,
}: {
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
}) {
  const chat = useAISDKChat();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const [text, setText] = useState("");
  const canSend = Boolean(chat) && text.trim().length > 0 && !isRunning;

  async function submit() {
    const trimmed = text.trim();
    if (!chat || !trimmed || isRunning) return;
    setText("");
    await chat.sendMessage({ text: trimmed });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  }

  return (
    <div className="qenex-composer-wrap">
      <div className="qenex-approval-mode" aria-label="审批模式">
        {(["ask", "auto"] as const).map((mode) => (
          <button
            type="button"
            key={mode}
            className={approvalMode === mode ? "active" : ""}
            aria-pressed={approvalMode === mode}
            disabled={isRunning}
            onClick={() => onApprovalModeChange(mode)}
          >
            {mode === "ask" ? "Ask" : "Auto"}
          </button>
        ))}
        <span>
          {approvalMode === "ask" ? "敏感操作先询问" : "自动批准可执行操作"}
        </span>
      </div>
      <form className="qenex-composer" onSubmit={onSubmit}>
        <textarea
          className="qenex-composer-input"
          placeholder="给 OpenCode 发送消息…"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!chat}
        />
        <div className="qenex-composer-actions">
          {isRunning ? (
            <button
              type="button"
              className="qenex-icon-btn danger"
              title="停止"
              onClick={() => void chat?.stop()}
            >
              <SquareIcon size={16} />
            </button>
          ) : (
            <button
              type="submit"
              className="qenex-icon-btn"
              title="发送"
              disabled={!canSend}
            >
              <ArrowUpIcon size={18} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function Thread({
  sessionId,
  approvalMode,
  onApprovalModeChange,
}: {
  sessionId: string;
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
}) {
  const chat = useAISDKChat();
  const messages = chat?.messages ?? [];
  const streamError =
    chat?.error != null
      ? formatBridgeError(chat.error, String(chat.error))
      : null;

  return (
    <ThreadPrimitive.Root className="qenex-thread">
      <ThreadPrimitive.Viewport className="qenex-thread-viewport">
        {messages.length === 0 ? (
          <div className="qenex-welcome">
            <h2>开始对话</h2>
            <p className="qenex-muted">消息经本地 Bridge 发给 OpenCode（ACP）。</p>
          </div>
        ) : null}

        {messages.map((message) => {
          if (message.role === "user") {
            return (
              <div key={message.id} className="qenex-msg user">
                <div className="qenex-bubble user">
                  {textFromParts(message.parts)}
                </div>
              </div>
            );
          }
          if (message.role === "assistant") {
            return (
              <div key={message.id} className="qenex-msg assistant">
                <div className="qenex-bubble assistant">
                  <MessageArtifacts metadata={message.metadata} />
                  <AssistantParts parts={message.parts ?? []} />
                </div>
              </div>
            );
          }
          return null;
        })}

        {streamError ? (
          <p className="qenex-error qenex-stream-error" role="alert">
            对话出错：{streamError}
          </p>
        ) : null}

        <ThreadPrimitive.ViewportFooter className="qenex-thread-footer">
          <ThreadPrimitive.ScrollToBottom className="qenex-scroll-bottom">
            滚动到底部
          </ThreadPrimitive.ScrollToBottom>
          <ApprovalPanel sessionId={sessionId} />
          <Composer
            approvalMode={approvalMode}
            onApprovalModeChange={onApprovalModeChange}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
