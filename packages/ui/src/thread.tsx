import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { useAISDKChat } from "@assistant-ui/react-ai-sdk";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import {
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
function Composer() {
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
  );
}

export function Thread() {
  const chat = useAISDKChat();
  const messages = chat?.messages ?? [];

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
                  <AssistantParts parts={message.parts ?? []} />
                </div>
              </div>
            );
          }
          return null;
        })}

        <ThreadPrimitive.ViewportFooter className="qenex-thread-footer">
          <ThreadPrimitive.ScrollToBottom className="qenex-scroll-bottom">
            滚动到底部
          </ThreadPrimitive.ScrollToBottom>
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
