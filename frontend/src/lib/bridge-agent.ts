import { HttpAgent, type RunAgentInput } from "@ag-ui/client";
import type { RunAgentParameters } from "@ag-ui/client";

export type SessionProps = {
  cwd: string;
  agentCommand: string[];
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
