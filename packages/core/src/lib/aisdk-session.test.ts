import { describe, expect, test, beforeEach } from "bun:test";
import type { QenexHost } from "@qenex/platform";
import {
  BridgeClientError,
  clearSessionBootCache,
  ensureAisdkSession,
  formatBridgeError,
  invalidateSessionBoot,
  isAisdkSessionId,
  sessionBootKey,
} from "./aisdk-session.ts";

function mockHost(fetchImpl: QenexHost["fetch"]): QenexHost {
  return {
    kind: "web",
    getBridgeBaseUrl: async () => "http://bridge.test",
    fetch: fetchImpl,
    pickWorkspace: async () => null,
    getDefaultWorkspace: async () => null,
    storage: {
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
    },
  };
}

beforeEach(() => {
  clearSessionBootCache();
});

describe("aisdk-session helpers", () => {
  test("isAisdkSessionId", () => {
    expect(isAisdkSessionId("ses_abc")).toBe(true);
    expect(isAisdkSessionId(crypto.randomUUID())).toBe(true);
    expect(isAisdkSessionId("pending:abc")).toBe(false);
    expect(isAisdkSessionId(null)).toBe(false);
  });

  test("sessionBootKey", () => {
    expect(sessionBootKey("tab-1", "/tmp/a")).toBe("tab-1::/tmp/a::opencode");
    expect(sessionBootKey("tab-1", "/tmp/a", "claude-acp")).toBe(
      "tab-1::/tmp/a::claude-acp",
    );
  });

  test("formatBridgeError maps known codes", () => {
    expect(
      formatBridgeError(
        new BridgeClientError("opencode_not_found", "missing", 503),
      ),
    ).toContain("OpenCode");
    expect(
      formatBridgeError(
        new BridgeClientError("opencode_auth_required", "auth", 401),
      ),
    ).toContain("登录");
    expect(
      formatBridgeError(
        new BridgeClientError("invalid_cwd", "cwd must be an existing directory: /tmp/missing", 400),
      ),
    ).toContain("工作区");
    expect(
      formatBridgeError(
        new BridgeClientError("invalid_cwd", "cwd must be an existing directory: /tmp/missing", 400),
      ),
    ).toContain("/tmp/missing");
    expect(formatBridgeError(new Error("boom"))).toBe("boom");
    expect(
      formatBridgeError(
        new Error(
          "Internal error: Upstream request failed: [invalid_request_error] Insufficient Balance",
        ),
      ),
    ).toContain("余额不足");
  });
});

describe("ensureAisdkSession dedupe", () => {
  test("concurrent callers share one POST /api/sessions", async () => {
    let posts = 0;
    const host = mockHost(async (_input, init) => {
      if (init?.method === "POST") {
        posts += 1;
        await Bun.sleep(20);
        return new Response(
          JSON.stringify({
            sessionId: "ses_dedupe",
            agent: "opencode",
            cwd: "/tmp/ws",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const [a, b] = await Promise.all([
      ensureAisdkSession("tab-x", "/tmp/ws", host),
      ensureAisdkSession("tab-x", "/tmp/ws", host),
    ]);
    expect(posts).toBe(1);
    expect(a.sessionId).toBe("ses_dedupe");
    expect(b.sessionId).toBe("ses_dedupe");

    const c = await ensureAisdkSession("tab-x", "/tmp/ws", host);
    expect(posts).toBe(1);
    expect(c.sessionId).toBe("ses_dedupe");

    invalidateSessionBoot("tab-x", "/tmp/ws");
    await ensureAisdkSession("tab-x", "/tmp/ws", host);
    expect(posts).toBe(2);
  });

  test("failed create clears cache so retry can POST again", async () => {
    let posts = 0;
    const host = mockHost(async () => {
      posts += 1;
      if (posts === 1) {
        return new Response(
          JSON.stringify({
            error: { code: "invalid_cwd", message: "bad" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          sessionId: "ses_retry",
          agent: "opencode",
          cwd: "/tmp/ws",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });

    await expect(
      ensureAisdkSession("tab-y", "/tmp/ws", host),
    ).rejects.toBeInstanceOf(BridgeClientError);
    const ok = await ensureAisdkSession("tab-y", "/tmp/ws", host);
    expect(posts).toBe(2);
    expect(ok.sessionId).toBe("ses_retry");
  });
});

describe("getAisdkSession", () => {
  test("returns null on 404 and payload on 200", async () => {
    const { getAisdkSession } = await import("./aisdk-session.ts");
    const host = mockHost(async (input) => {
      const url = String(input);
      if (url.includes("ses_missing")) {
        return new Response(
          JSON.stringify({
            error: { code: "session_not_found", message: "gone" },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          sessionId: "ses_alive",
          agent: "opencode",
          cwd: "/tmp/ws",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    expect(await getAisdkSession("ses_missing", host)).toBeNull();
    const hit = await getAisdkSession("ses_alive", host);
    expect(hit?.sessionId).toBe("ses_alive");
  });
});

describe("approval REST helpers", () => {
  test("listPendingApprovals + respondToApproval", async () => {
    const {
      listPendingApprovals,
      respondToApproval,
    } = await import("./aisdk-session.ts");
    let posted: unknown;
    const host = mockHost(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/approvals") && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            mode: "ask",
            approvals: [
              {
                approvalId: "appr_1",
                sessionId: "ses_1",
                createdAt: new Date().toISOString(),
                toolCall: { toolCallId: "tc_1", title: "edit" },
                options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/approvals/") && init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 404 });
    });

    const list = await listPendingApprovals("ses_1", host);
    expect(list).toHaveLength(1);
    expect(list[0]?.approvalId).toBe("appr_1");
    await respondToApproval("ses_1", "appr_1", "once", host);
    expect(posted).toEqual({ optionId: "once" });
  });
});

describe("listAisdkSessionMessages", () => {
  test("parses messages array", async () => {
    const { listAisdkSessionMessages } = await import("./aisdk-session.ts");
    const host = mockHost(async (input) => {
      const url = String(input);
      expect(url).toContain("/api/sessions/ses_x/messages");
      return new Response(
        JSON.stringify({
          sessionId: "ses_x",
          messages: [
            { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const messages = await listAisdkSessionMessages("ses_x", host);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("u1");
  });
});

describe("session config REST helpers", () => {
  test("get / set mode / set model", async () => {
    const {
      getAisdkSessionConfig,
      setAisdkSessionMode,
      setAisdkSessionModel,
    } = await import("./aisdk-session.ts");
    const host = mockHost(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/config") && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            sessionId: "ses_c",
            modes: [{ id: "build", name: "Build" }],
            models: [{ id: "m1", name: "Model 1" }],
            currentModeId: "build",
            currentModelId: "m1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/mode") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.modeId).toBe("plan");
        return new Response(
          JSON.stringify({
            modes: [
              { id: "build", name: "Build" },
              { id: "plan", name: "Plan" },
            ],
            currentModeId: "plan",
            models: [{ id: "m1", name: "Model 1" }],
            currentModelId: "m1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/model") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.modelId).toBe("m2");
        return new Response(
          JSON.stringify({
            modes: [{ id: "plan", name: "Plan" }],
            currentModeId: "plan",
            models: [
              { id: "m1", name: "Model 1" },
              { id: "m2", name: "Model 2" },
            ],
            currentModelId: "m2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("nope", { status: 404 });
    });

    const cfg = await getAisdkSessionConfig("ses_c", host);
    expect(cfg.ready).toBe(true);
    expect(cfg.currentModeId).toBe("build");
    expect(cfg.modes[0]?.id).toBe("build");

    const afterMode = await setAisdkSessionMode("ses_c", "plan", host);
    expect(afterMode.currentModeId).toBe("plan");

    const afterModel = await setAisdkSessionModel("ses_c", "m2", host);
    expect(afterModel.currentModelId).toBe("m2");
  });
});
