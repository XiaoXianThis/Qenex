import { useEffect } from "react";
import { changesActions, type BridgeHttpAgent } from "@qenex/core";

type ChangesRefreshBridgeProps = {
  agent: BridgeHttpAgent;
  threadId: string;
};

/** Refresh Changes when a run ends (after Bridge may commit a git turn). */
export function ChangesRefreshBridge({
  agent,
  threadId,
}: ChangesRefreshBridgeProps) {
  useEffect(() => {
    const subscription = agent.subscribe({
      onRunFinishedEvent: () => {
        changesActions.bumpAfterRun(threadId);
      },
      onRunErrorEvent: () => {
        changesActions.bumpAfterRun(threadId);
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, threadId]);

  return null;
}
