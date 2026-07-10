"use client";

import { useEffect } from "react";
import {
  toolProgressActions,
  type BridgeHttpAgent,
} from "@qenex/core";

type ToolProgressBridgeProps = {
  agent: BridgeHttpAgent;
};

function progressTextFromValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as {
    toolCallId?: string;
    text?: string;
    content?: unknown;
  };
  if (typeof v.text === "string" && v.text.length > 0) {
    return v.text;
  }
  if (typeof v.content === "string") {
    return v.content;
  }
  return null;
}

/** Subscribes to CUSTOM tool_call_progress and feeds the tool-progress store. */
export function ToolProgressBridge({ agent }: ToolProgressBridgeProps) {
  useEffect(() => {
    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== "tool_call_progress") return;
        const value = event.value as
          | { toolCallId?: string; text?: string; content?: unknown }
          | undefined;
        const toolCallId = value?.toolCallId;
        if (!toolCallId) return;
        const text = progressTextFromValue(value);
        if (text != null) {
          toolProgressActions.setProgress(toolCallId, text);
        }
      },
      onToolCallEndEvent: ({ event }) => {
        if (event.toolCallId) toolProgressActions.clear(event.toolCallId);
      },
      onRunStartedEvent: () => {
        toolProgressActions.clearAll();
      },
    });
    return () => subscription.unsubscribe();
  }, [agent]);

  return null;
}
