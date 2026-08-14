import { describe, expect, test } from "bun:test";
import { ApprovalManager } from "../src/approval-manager.ts";
import { SessionOperationQueue } from "../src/agent/runtime/session-operation-queue.ts";

const permissionParams = {
  sessionId: "ses_local",
  toolCall: {
    toolCallId: "call_test",
    title: "write file",
    kind: "edit",
  },
  options: [
    { optionId: "once", name: "Allow once", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SessionOperationQueue", () => {
  test("chat and probe do not interleave", async () => {
    const queue = new SessionOperationQueue();
    const order: string[] = [];
    let releaseChat!: () => void;
    const chatHeld = new Promise<void>((resolve) => {
      releaseChat = resolve;
    });

    const chat = queue.run("ses_a", "chat", async () => {
      order.push("chat-start");
      await chatHeld;
      order.push("chat-end");
    });
    await wait(5);
    const probe = queue.run("ses_a", "probe-model-config", async () => {
      order.push("probe");
    });
    await wait(15);
    expect(order).toEqual(["chat-start"]);
    expect(queue.currentKind("ses_a")).toBe("chat");
    releaseChat();
    await Promise.all([chat, probe]);
    expect(order).toEqual(["chat-start", "chat-end", "probe"]);
  });

  test("setModel and probe serialize on the same session", async () => {
    const queue = new SessionOperationQueue();
    const order: string[] = [];
    let releaseSetModel!: () => void;
    const setModelHeld = new Promise<void>((resolve) => {
      releaseSetModel = resolve;
    });

    const setModel = queue.run("ses_b", "set-model", async () => {
      order.push("set-model-start");
      await setModelHeld;
      order.push("set-model-end");
    });
    await wait(5);
    const probe = queue.run("ses_b", "probe-model-config", async () => {
      order.push("probe");
    });
    await wait(15);
    expect(order).toEqual(["set-model-start"]);
    releaseSetModel();
    await Promise.all([setModel, probe]);
    expect(order).toEqual(["set-model-start", "set-model-end", "probe"]);
  });

  test("approval respond is not queued and works while chat holds the mutex", async () => {
    const queue = new SessionOperationQueue();
    const approvals = new ApprovalManager();
    approvals.setMode("ask");
    let releaseChat!: () => void;
    const chatHeld = new Promise<void>((resolve) => {
      releaseChat = resolve;
    });
    const chat = queue.run("ses_c", "chat", () => chatHeld);

    const pending = approvals.handlePermissionRequest(permissionParams);
    await wait(5);
    expect(queue.isBusy("ses_c")).toBe(true);
    const [card] = approvals.list();
    expect(card).toBeTruthy();
    approvals.decide(card!.approvalId, "once");
    expect(await pending).toEqual({
      outcome: { outcome: "selected", optionId: "once" },
    });

    releaseChat();
    await chat;
  });

  test("interrupt aborts the current op instead of enqueueing stop", async () => {
    const queue = new SessionOperationQueue();
    const chat = queue.run("ses_d", "chat", async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });
    await wait(5);
    const order: string[] = [];
    const probe = queue.run("ses_d", "probe-model-config", async () => {
      order.push("probe");
    });
    queue.interrupt("ses_d");
    await expect(chat).rejects.toThrow("aborted");
    await probe;
    expect(order).toEqual(["probe"]);
  });

  test("different sessions are not serialized together", async () => {
    const queue = new SessionOperationQueue();
    const started: string[] = [];
    let releaseA!: () => void;
    const heldA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const a = queue.run("ses_1", "chat", async () => {
      started.push("a");
      await heldA;
    });
    const b = queue.run("ses_2", "set-model", async () => {
      started.push("b");
    });
    await wait(10);
    expect(started.sort()).toEqual(["a", "b"]);
    releaseA();
    await Promise.all([a, b]);
  });
});
