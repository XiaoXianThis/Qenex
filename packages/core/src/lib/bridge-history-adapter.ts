import type { ChatModelRunOptions, ChatModelRunResult } from "@assistant-ui/core";
import type { ThreadHistoryAdapter } from "@assistant-ui/core";
import type { AguiEvent } from "./bridge-agent.ts";
import type { PollEventsResponse, TaskSummary } from "./bridge-api.ts";
import {
  hasIncompleteRun,
  replayAgUiEvents,
  RunReplayAggregator,
} from "./replay-agui-events.ts";

export type BridgeHistoryResumeOptions = {
  getStatus?: (taskId: string) => Promise<TaskSummary>;
  pollEvents?: (
    taskId: string,
    options?: { runId?: string; afterId?: number },
  ) => Promise<PollEventsResponse>;
  /** Poll interval while waiting for more events (ms). */
  pollIntervalMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 400;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Strip trailing incomplete assistant so `unstable_resume` can attach a fresh
 * placeholder after the last user message (assistant-ui resetHead semantics).
 */
export function prepareHistoryForResume(
  events: AguiEvent[],
  shouldResume: boolean,
): Awaited<ReturnType<ThreadHistoryAdapter["load"]>> {
  const repo = replayAgUiEvents(events);
  if (!shouldResume) {
    return repo;
  }

  const messages = [...repo.messages];
  const last = messages.at(-1);
  if (last?.message.role === "assistant") {
    messages.pop();
  }
  const headId = messages.at(-1)?.message.id ?? null;
  return {
    messages,
    headId,
    unstable_resume: true,
  };
}

export async function* streamResumedRun(
  taskId: string,
  pollEvents: NonNullable<BridgeHistoryResumeOptions["pollEvents"]>,
  options: {
    runId?: string;
    abortSignal?: AbortSignal;
    pollIntervalMs?: number;
  } = {},
): AsyncGenerator<ChatModelRunResult, void, unknown> {
  const aggregator = new RunReplayAggregator();
  let afterId = 0;
  let runId = options.runId;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  while (!options.abortSignal?.aborted) {
    const batch = await pollEvents(taskId, {
      runId,
      afterId,
    });
    if (batch.runId) {
      runId = batch.runId;
    }
    afterId = batch.afterId;

    for (const event of batch.events) {
      if (event.type === "CUSTOM") continue;
      aggregator.handle(event);
      const snapshot = aggregator.getSnapshot();
      if (snapshot) {
        yield snapshot;
      }
    }

    if (batch.done) {
      const snapshot = aggregator.getSnapshot();
      if (snapshot?.status?.type === "running") {
        yield {
          ...snapshot,
          status: { type: "complete", reason: "unknown" },
        };
      }
      return;
    }

    try {
      await sleep(interval, options.abortSignal);
    } catch {
      return;
    }
  }
}

/**
 * Resume only when events show an open run AND (if available) Bridge still
 * reports running. A stale `running` status alone must not strip completed
 * assistant messages after refresh.
 */
export function shouldResumeHistory(
  events: AguiEvent[],
  taskStatus?: Pick<TaskSummary, "status"> | null,
): boolean {
  if (!hasIncompleteRun(events)) {
    return false;
  }
  if (!taskStatus) {
    return true;
  }
  return taskStatus.status === "running";
}

export function createBridgeHistoryAdapter(
  loadEvents: (taskId: string) => Promise<AguiEvent[]>,
  taskId: string,
  resumeOptions?: BridgeHistoryResumeOptions,
): ThreadHistoryAdapter {
  return {
    async load() {
      const events = await loadEvents(taskId);
      if (events.length === 0) {
        return { messages: [] };
      }

      let taskStatus: TaskSummary | null = null;
      if (resumeOptions?.getStatus) {
        try {
          taskStatus = await resumeOptions.getStatus(taskId);
        } catch {
          // Fall back to event-based detection.
        }
      }

      return prepareHistoryForResume(
        events,
        shouldResumeHistory(events, taskStatus),
      );
    },
    async *resume(options: ChatModelRunOptions) {
      if (!resumeOptions?.pollEvents) {
        return;
      }
      let runId: string | undefined;
      if (resumeOptions.getStatus) {
        try {
          const status = await resumeOptions.getStatus(taskId);
          runId = status.currentRunId ?? undefined;
        } catch {
          // poll endpoint can resolve latest run_id
        }
      }
      yield* streamResumedRun(taskId, resumeOptions.pollEvents, {
        runId,
        abortSignal: options.abortSignal,
        pollIntervalMs: resumeOptions.pollIntervalMs,
      });
    },
    async append() {
      // History is persisted on the backend; no local append needed.
    },
  };
}
