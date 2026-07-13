import { useEffect } from "react";
import { useSessionConfig, type BridgeHttpAgent } from "@qenex/core";

type ModeSyncBridgeProps = {
  agent: BridgeHttpAgent;
};

/** Keep SessionConfigBar in sync when the agent pushes mode updates. */
export function ModeSyncBridge({ agent }: ModeSyncBridgeProps) {
  const { refresh } = useSessionConfig();

  useEffect(() => {
    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== "agent:mode_update") return;
        void refresh();
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, refresh]);

  return null;
}
