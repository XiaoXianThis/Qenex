import { HttpAgent, type RunAgentInput } from "@ag-ui/client";
import type { RunAgentParameters } from "@ag-ui/client";
import { bridgeFetch } from "./bridge-client.ts";

export type SessionProps = {
  cwd: string;
  agentCommand: string[];
};

export type AguiEvent = {
  type: string;
  [key: string]: unknown;
};

export class BridgeHttpAgent extends HttpAgent {
  private sessionProps: SessionProps;

  constructor(
    url: string,
    sessionProps: SessionProps,
    threadId?: string,
  ) {
    super({ url, threadId });
    this.sessionProps = sessionProps;
  }

  updateSessionProps(sessionProps: SessionProps, threadId: string) {
    this.sessionProps = sessionProps;
    this.threadId = threadId;
  }

  async loadHistory(taskId: string): Promise<AguiEvent[]> {
    try {
      const response = await bridgeFetch(`/v2/tasks/${taskId}/messages`);
      if (!response.ok) {
        console.warn(`Failed to load history for task ${taskId}:`, response.statusText);
        return [];
      }

      const data = await response.json();
      return data.events as AguiEvent[];
    } catch (error) {
      console.error("Failed to load session history:", error);
      return [];
    }
  }

  protected prepareRunAgentInput(
    parameters?: RunAgentParameters,
  ): RunAgentInput {
    const input = super.prepareRunAgentInput(parameters);
    return {
      ...input,
      threadId: this.threadId || input.threadId,
      forwardedProps: {
        ...input.forwardedProps,
        cwd: this.sessionProps.cwd,
        agentCommand: this.sessionProps.agentCommand,
      },
    };
  }
}
