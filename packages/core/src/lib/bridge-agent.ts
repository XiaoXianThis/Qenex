import { HttpAgent, type RunAgentInput } from "@ag-ui/client";
import type { RunAgentParameters } from "@ag-ui/client";
import { cancelTask } from "./bridge-api.ts";
import { bridgeFetch } from "./bridge-client.ts";

export type SessionProps = {
  cwd: string;
  agentId: string;
  /** Optional override; empty/undefined lets Bridge resolve from agentId. */
  agentCommand?: string[];
};

export type AguiEvent = {
  type: string;
  [key: string]: unknown;
};

export class BridgeHttpAgent extends HttpAgent {
  private sessionProps: SessionProps;
  private pendingCancel: Promise<void> | null = null;

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
    const response = await bridgeFetch(`/v2/tasks/${taskId}/messages`);
    if (!response.ok) {
      throw new Error(
        `Failed to load history for task ${taskId}: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    if (
      typeof data !== "object" ||
      data === null ||
      !Array.isArray((data as { events?: unknown }).events)
    ) {
      throw new Error(`Invalid history response for task ${taskId}`);
    }
    return (data as { events: AguiEvent[] }).events;
  }

  override abortRun(): void {
    const taskId = this.threadId;
    if (taskId) {
      const request = cancelTask(taskId)
        .catch((error) => {
          console.error(`Failed to cancel backend run for task ${taskId}:`, error);
        })
        .finally(() => {
          if (this.pendingCancel === request) {
            this.pendingCancel = null;
          }
        });
      this.pendingCancel = request;
    }
    super.abortRun();
  }

  override async runAgent(
    ...args: Parameters<HttpAgent["runAgent"]>
  ): Promise<Awaited<ReturnType<HttpAgent["runAgent"]>>> {
    // A new send after Stop waits until the backend has emitted and persisted the
    // cancelled terminal event. The server also rejects overlapping runs.
    await this.pendingCancel;
    return super.runAgent(...args);
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
        agentId: this.sessionProps.agentId,
        ...(this.sessionProps.agentCommand &&
        this.sessionProps.agentCommand.length > 0
          ? { agentCommand: this.sessionProps.agentCommand }
          : {}),
      },
    };
  }
}
