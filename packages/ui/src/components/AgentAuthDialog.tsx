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
import type { AuthChallenge, AuthMethodInfo } from "@qenex/core";
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
  const preferred = methods.find((m) => m.id === "cursor_login");
  return preferred ?? methods[0]!;
}

function cliCommandFor(method: AuthMethodInfo | null): string | null {
  if (!method) return null;
  if (method.id === "cursor_login") return "agent login";
  if (method.id.includes("claude")) return "claude";
  if (method.id.includes("codex")) return "codex login";
  return null;
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
  const cliCommand = cliCommandFor(method);
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
      setLocalError(error instanceof Error ? error.message : "重试失败");
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
            {method?.description?.trim() ||
              challenge.detail ||
              "此 Agent 需要先完成认证才能创建会话。"}
          </DialogDescription>
        </DialogHeader>

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

          {externalHint || cliCommand ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
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
          ) : null}
        </div>

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
            我已登录，重试
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
