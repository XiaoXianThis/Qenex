import { describe, expect, test } from "bun:test";
import {
  hasIncompleteRun,
  replayAgUiEvents,
} from "./replay-agui-events.ts";
import {
  prepareHistoryForResume,
  shouldResumeHistory,
  streamResumedRun,
} from "./bridge-history-adapter.ts";
import type { AguiEvent } from "./bridge-agent.ts";

function ev(partial: AguiEvent): AguiEvent {
  return partial;
}

describe("hasIncompleteRun", () => {
  test("false for empty", () => {
    expect(hasIncompleteRun([])).toBe(false);
  });

  test("true when RUN_STARTED without terminal", () => {
    expect(
      hasIncompleteRun([
        ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
        ev({
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m1",
          delta: "hi",
        }),
      ]),
    ).toBe(true);
  });

  test("false after RUN_FINISHED", () => {
    expect(
      hasIncompleteRun([
        ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
        ev({ type: "RUN_FINISHED", runId: "r1", taskId: "t" }),
      ]),
    ).toBe(false);
  });
});

describe("shouldResumeHistory", () => {
  const incomplete: AguiEvent[] = [
    ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
    ev({ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "x" }),
  ];
  const complete: AguiEvent[] = [
    ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
    ev({ type: "RUN_FINISHED", runId: "r1", taskId: "t" }),
  ];

  test("false when events are complete even if status is running (stale)", () => {
    expect(shouldResumeHistory(complete, { status: "running" })).toBe(false);
  });

  test("false when status is idle even if events look incomplete", () => {
    expect(shouldResumeHistory(incomplete, { status: "idle" })).toBe(false);
  });

  test("true only when both incomplete events and running status", () => {
    expect(shouldResumeHistory(incomplete, { status: "running" })).toBe(true);
  });

  test("falls back to events when status is unavailable", () => {
    expect(shouldResumeHistory(incomplete, null)).toBe(true);
    expect(shouldResumeHistory(complete, null)).toBe(false);
  });
});

describe("prepareHistoryForResume", () => {
  test("strips trailing assistant and sets unstable_resume", () => {
    const events: AguiEvent[] = [
      ev({
        type: "CUSTOM",
        name: "user_message",
        value: { content: "hello" },
      }),
      ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
      ev({ type: "TEXT_MESSAGE_START", messageId: "a1" }),
      ev({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "a1",
        delta: "partial",
      }),
    ];
    const repo = prepareHistoryForResume(events, true);
    expect(repo.unstable_resume).toBe(true);
    expect(repo.messages.every((m) => m.message.role === "user")).toBe(true);
    expect(repo.messages).toHaveLength(1);
  });

  test("keeps completed history when not resuming", () => {
    const events: AguiEvent[] = [
      ev({
        type: "CUSTOM",
        name: "user_message",
        value: { content: "hello" },
      }),
      ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
      ev({ type: "TEXT_MESSAGE_START", messageId: "a1" }),
      ev({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "a1",
        delta: "done",
      }),
      ev({ type: "TEXT_MESSAGE_END", messageId: "a1" }),
      ev({ type: "RUN_FINISHED", runId: "r1", taskId: "t" }),
    ];
    const repo = prepareHistoryForResume(events, false);
    expect(repo.unstable_resume).toBeUndefined();
    expect(repo.messages.map((m) => m.message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });
});

describe("streamResumedRun", () => {
  test("polls until done and yields snapshots", async () => {
    const batches = [
      {
        events: [
          ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
          ev({ type: "TEXT_MESSAGE_START", messageId: "a1" }),
          ev({
            type: "TEXT_MESSAGE_CONTENT",
            messageId: "a1",
            delta: "Hel",
          }),
        ] as AguiEvent[],
        afterId: 3,
        done: false,
        runId: "r1",
      },
      {
        events: [
          ev({
            type: "TEXT_MESSAGE_CONTENT",
            messageId: "a1",
            delta: "lo",
          }),
          ev({ type: "TEXT_MESSAGE_END", messageId: "a1" }),
          ev({ type: "RUN_FINISHED", runId: "r1", taskId: "t" }),
        ] as AguiEvent[],
        afterId: 6,
        done: true,
        runId: "r1",
      },
    ];
    let call = 0;
    const results: Array<{ status?: { type: string }; content?: unknown }> =
      [];
    for await (const snap of streamResumedRun(
      "task-1",
      async () => batches[call++]!,
      { pollIntervalMs: 1 },
    )) {
      results.push(snap as { status?: { type: string }; content?: unknown });
    }
    expect(call).toBe(2);
    expect(results.length).toBeGreaterThan(0);
    const last = results.at(-1)!;
    expect(last.status?.type).toBe("complete");
  });
});

describe("replayAgUiEvents preserveRunning", () => {
  test("marks incomplete assistant as running when requested", () => {
    const events: AguiEvent[] = [
      ev({
        type: "CUSTOM",
        name: "user_message",
        value: { content: "q" },
      }),
      ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
      ev({ type: "TEXT_MESSAGE_START", messageId: "a1" }),
      ev({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "a1",
        delta: "…",
      }),
    ];
    const repo = replayAgUiEvents(events, { preserveRunning: true });
    const assistant = repo.messages.find((m) => m.message.role === "assistant");
    expect(assistant?.message.status?.type).toBe("running");
  });
});

describe("replayAgUiEvents image attachments", () => {
  test("restores AG-UI multimodal image source as attachment", () => {
    const events: AguiEvent[] = [
      ev({
        type: "CUSTOM",
        name: "user_message",
        value: {
          content: "see this",
          message: {
            role: "user",
            content: [
              { type: "text", text: "see this" },
              {
                type: "image",
                source: {
                  type: "data",
                  value: "iVBORw0KGgo=",
                  mimeType: "image/png",
                },
                metadata: { filename: "shot.png" },
              },
            ],
          },
        },
      }),
      ev({ type: "RUN_STARTED", runId: "r1", taskId: "t", threadId: "t" }),
      ev({ type: "RUN_FINISHED", runId: "r1", taskId: "t" }),
    ];

    const repo = replayAgUiEvents(events);
    const user = repo.messages.find((m) => m.message.role === "user");
    expect(user).toBeTruthy();
    expect(user!.message.role).toBe("user");
    if (user!.message.role !== "user") return;

    const text = user!.message.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    expect(text).toBe("see this");

    expect(user!.message.attachments).toHaveLength(1);
    const att = user!.message.attachments![0]!;
    expect(att.type).toBe("image");
    expect(att.name).toBe("shot.png");
    expect(att.content[0]?.type).toBe("image");
    if (att.content[0]?.type === "image") {
      expect(att.content[0].image).toBe(
        "data:image/png;base64,iVBORw0KGgo=",
      );
    }
  });

  test("restores image-only user turn", () => {
    const events: AguiEvent[] = [
      ev({
        type: "CUSTOM",
        name: "user_message",
        value: {
          content: "[attachment]",
          message: {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "data",
                  value: "abc",
                  mimeType: "image/jpeg",
                },
              },
            ],
          },
        },
      }),
    ];

    const repo = replayAgUiEvents(events);
    const user = repo.messages.find((m) => m.message.role === "user");
    expect(user!.message.role).toBe("user");
    if (user!.message.role !== "user") return;
    expect(user!.message.attachments).toHaveLength(1);
    expect(user!.message.attachments![0]!.type).toBe("image");
    const img = user!.message.attachments![0]!.content[0];
    expect(img?.type).toBe("image");
    if (img?.type === "image") {
      expect(img.image).toBe("data:image/jpeg;base64,abc");
    }
  });

  test("restores legacy flat attachment shape", () => {
    const events: AguiEvent[] = [
      ev({
        type: "CUSTOM",
        name: "user_message",
        value: {
          content: "caption",
          message: {
            role: "user",
            content: "caption",
            attachments: [
              {
                type: "image",
                name: "old.png",
                data: "xyz",
                mimeType: "image/png",
              },
            ],
          },
        },
      }),
    ];

    const repo = replayAgUiEvents(events);
    const user = repo.messages.find((m) => m.message.role === "user");
    expect(user!.message.role).toBe("user");
    if (user!.message.role !== "user") return;
    expect(user!.message.attachments).toHaveLength(1);
    const img = user!.message.attachments![0]!.content[0];
    expect(img?.type).toBe("image");
    if (img?.type === "image") {
      expect(img.image).toBe("data:image/png;base64,xyz");
    }
  });
});
