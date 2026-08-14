"use client";

import { AgentIcon } from "@/components/AgentIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatBridgeError,
  isInteractiveAuthMethod,
  type AuthChallenge,
  type AuthMethodInfo,
} from "@qenex/core";
import { CheckCircle2, Copy, KeyRound, Loader2, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FC } from "react";

type AgentAuthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  challenge: AuthChallenge;
  onRetry: () => Promise<void>;
};

function primaryMethod(methods: AuthMethodInfo[]): AuthMethodInfo | null {
  if (methods.length === 0) return null;
  const preferredIds = ["cursor_login", "chat-gpt", "oauth-personal", "agent-login", "login"];
  const preferred = preferredIds
    .map((id) => methods.find((method) => method.id === id))
    .find((method) => method !== undefined);
  return preferred ?? methods[0]!;
}

function cliCommandForMethodId(methodId: string): string | null {
  const id = methodId.trim().toLowerCase();
  if (!id) return null;
  if (id === "cursor_login" || id.includes("cursor")) return "agent login";
  if (id === "chat-gpt" || id.includes("codex")) return "codex login";
  if (id.includes("opencode")) return "opencode auth login";
  if (id.includes("gemini")) return "gemini";
  if (id.includes("qoder")) return "qoder";
  if (id === "pi" || id.includes("pi-acp") || /(^|[-_])pi([-_]|$)/.test(id)) {
    return "pi";
  }
  if (id.includes("claude")) return "claude";
  return null;
}

function cliCommandForAgentId(agentId: string): string | null {
  const id = agentId.trim().toLowerCase();
  if (id === "cursor" || id === "cursor-agent") return "agent login";
  if (id === "codex" || id === "codex-acp") return "codex login";
  if (id === "opencode") return "opencode auth login";
  if (id === "gemini") return "gemini";
  if (id === "qoder") return "qoder";
  if (id === "pi" || id === "pi-acp") return "pi";
  if (id === "claude" || id === "claude-acp") return "claude";
  return null;
}

function cliCommandFor(
  method: AuthMethodInfo | null,
  agentId: string,
): string | null {
  if (method) {
    const mapped = cliCommandForMethodId(method.id);
    if (mapped) return mapped;
  }
  return cliCommandForAgentId(agentId);
}

export const AgentAuthDialog: FC<AgentAuthDialogProps> = ({
  open,
  onOpenChange,
  agentId,
  challenge,
  onRetry,
}) => {
  const method = useMemo(
    () => primaryMethod(challenge.methods),
    [challenge.methods],
  );
  const interactive = isInteractiveAuthMethod(method);
  const cliCommand = cliCommandFor(method, agentId);
  const externalHint =
    method?.externalHint ??
    (challenge.methods[0]?.externalHint ?? null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setCopied(false);
      setLocalError(null);
    }
  }, [open]);

  const titleName = challenge.agentName?.trim() || agentId;

  const handleCopy = useCallback(async () => {
    if (!cliCommand) return;
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setLocalError("复制失败，请手动输入命令");
    }
  }, [cliCommand]);

  const handleRetry = useCallback(async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await onRetry();
      onOpenChange(false);
    } catch (error) {
      setLocalError(formatBridgeError(error, "重试失败"));
    } finally {
      setBusy(false);
    }
  }, [onOpenChange, onRetry]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <AgentIcon
              agentId={agentId}
              className="size-6 shrink-0"
              aria-hidden
            />
            <DialogTitle>{titleName} 需要登录</DialogTitle>
          </div>
          <DialogDescription className="text-left">
            {interactive
              ? "将自动打开系统浏览器完成账号授权。完成后会话会自动继续。"
              : method?.description?.trim() ||
                challenge.detail ||
                "此 Agent 需要先完成认证才能创建会话。请在终端完成登录后重试。"}
          </DialogDescription>
        </DialogHeader>

        {interactive ? (
          <p className="text-sm text-muted-foreground">
            若登录页没有出现，点下方按钮再试一次。
          </p>
        ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
          {method ? (
            <div className="flex items-start gap-2">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-medium">{method.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  methodId: {method.id}
                </p>
              </div>
            </div>
          ) : null}

          <div
            className={
              method
                ? "flex flex-col gap-2 border-t border-border pt-3"
                : "flex flex-col gap-2"
            }
          >
            <div className="flex items-start gap-2">
              <Terminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-[13px] text-muted-foreground">
                {externalHint ??
                  "请先在终端完成登录，然后回到此处点击「我已登录」。"}
              </p>
            </div>
            {cliCommand ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">
                  {cliCommand}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void handleCopy()}
                >
                  {copied ? (
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        )}

        {localError ? (
          <p className="text-xs text-destructive">{localError}</p>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            稍后再说
          </Button>
          <Button
            type="button"
            disabled={busy}
            className="gap-1.5"
            onClick={() => void handleRetry()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            {interactive ? (busy ? "正在打开登录页…" : "打开登录页") : "我已登录，重试"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
