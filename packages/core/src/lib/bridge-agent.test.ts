import { afterEach, describe, expect, test } from "bun:test";
import type { QenexHost } from "@qenex/platform";
import { BridgeHttpAgent } from "./bridge-agent.ts";
import { clearBridgeHost, setBridgeHost } from "./bridge-client.ts";

function hostWithFetch(
  fetch: QenexHost["fetch"],
): QenexHost {
  return {
    kind: "web",
    fetch,
    getBridgeBaseUrl: async () => "",
    pickWorkspace: async () => null,
    getDefaultWorkspace: async () => null,
    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
  };
}

afterEach(() => {
  clearBridgeHost();
});

describe("BridgeHttpAgent lifecycle", () => {
  test("abortRun calls the backend cancel endpoint", async () => {
    const requests: Array<{ path: string; method?: string }> = [];
    setBridgeHost(
      hostWithFetch(async (path, init) => {
        requests.push({ path, method: init?.method });
        return Response.json({ success: true });
      }),
    );
    const agent = new BridgeHttpAgent(
      "/ag-ui",
      { cwd: "/tmp", agentId: "test" },
      "task-1",
    );

    agent.abortRun();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests).toEqual([
      { path: "/v2/tasks/task-1/cancel", method: "POST" },
    ]);
  });

  test("history transport failures are not presented as empty history", async () => {
    setBridgeHost(
      hostWithFetch(async () => new Response("down", { status: 503 })),
    );
    const agent = new BridgeHttpAgent(
      "/ag-ui",
      { cwd: "/tmp", agentId: "test" },
      "task-1",
    );

    await expect(agent.loadHistory("task-1")).rejects.toThrow(
      "Failed to load history",
    );
  });
});
