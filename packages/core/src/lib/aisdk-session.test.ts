import { describe, expect, test, beforeEach } from "bun:test";
import type { QenexHost } from "@qenex/platform";
import {
  BridgeClientError,
  authChallengeFromError,
  clearSessionBootCache,
  createAisdkSession,
  ensureAisdkSession,
  formatBridgeError,
  invalidateSessionBoot,
  isAisdkSessionId,
  SESSION_CREATE_TIMEOUT_MS,
  sessionBootKey,
  toAisdkSessionConfig,
} from "./aisdk-session.ts";
import { isAuthRequiredError } from "./bridge-client.ts";

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

  test("formatBridgeError does not emit [object Object]", () => {
    expect(
      formatBridgeError(
        new BridgeClientError("set_model_failed", "[object Object]", 502),
      ),
    ).toBe("切换模型失败。");
    expect(
      formatBridgeError(
        new BridgeClientError("set_model_failed", {
          message: "model rejected",
        } as unknown as string, 502),
      ),
    ).toContain("model rejected");
    expect(formatBridgeError({ message: { message: "nested" } })).toBe("nested");
  });

  test("formatBridgeError auth_required is Chinese with agent name", () => {
    const err = new BridgeClientError(
      "auth_required",
      "gemini requires authentication. Complete login for this agent, then retry.",
      409,
      { methods: [], agentName: "gemini" },
    );
    const text = formatBridgeError(err);
    expect(text).toContain("gemini");
    expect(text).toContain("需要登录");
    expect(text).not.toContain("requires authentication");
    expect(text).not.toContain("[object Object]");
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

describe("createAisdkSession auth errors", () => {
  test("create session waits long enough for in-process browser login", () => {
    expect(SESSION_CREATE_TIMEOUT_MS).toBe(8 * 60_000);
  });

  test("preserves methods and is detectable as auth required", async () => {
    const host = mockHost(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "auth_required",
            message: {
              text: "gemini requires authentication. Complete login for this agent, then retry.",
            },
            details: {
              methods: [
                {
                  id: "google_login",
                  type: "browser",
                  name: "Google",
                  description: "Sign in with Google",
                },
              ],
              agentName: "gemini",
              cause: "unauthorized",
            },
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    });

    let caught: unknown;
    try {
      await createAisdkSession("/tmp/ws", host, { agentId: "gemini" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BridgeClientError);
    expect(isAuthRequiredError(caught)).toBe(true);
    const client = caught as BridgeClientError;
    expect(client.code).toBe("auth_required");
    expect(client.message).not.toContain("[object Object]");
    expect(client.details).toMatchObject({
      agentName: "gemini",
      methods: [{ id: "google_login" }],
    });
    const challenge = authChallengeFromError(client, "Gemini CLI");
    expect(challenge.agentName).toBe("Gemini CLI");
    expect(challenge.methods[0]?.id).toBe("google_login");
    expect(challenge.detail).toContain("需要登录");
    expect(challenge.detail).not.toContain("requires authentication");
  });

  test("detects auth even when methods are missing", async () => {
    const host = mockHost(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "auth_required",
            message: "gemini requires authentication. Complete login for this agent, then retry.",
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    });
    let caught: unknown;
    try {
      await createAisdkSession("/tmp/ws", host);
    } catch (error) {
      caught = error;
    }
    expect(isAuthRequiredError(caught)).toBe(true);
    expect(authChallengeFromError(caught).methods).toEqual([]);
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

describe("warmupAisdkSession", () => {
  test("GETs /api/sessions/:id/config without mutating", async () => {
    const { warmupAisdkSession } = await import("./aisdk-session.ts");
    const calls: Array<{ url: string; method: string }> = [];
    const host = mockHost(async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      expect(url).toContain("/api/sessions/ses_warm/config");
      return new Response(
        JSON.stringify({
          sessionId: "ses_warm",
          modes: [{ id: "build", name: "Build" }],
          currentModeId: "build",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    await warmupAisdkSession("ses_warm", host);
    expect(calls).toEqual([
      { url: "http://bridge.test/api/sessions/ses_warm/config", method: "GET" },
    ]);
  });
});

describe("hibernateAisdkSession", () => {
  test("POSTs /api/sessions/:id/hibernate", async () => {
    const { hibernateAisdkSession } = await import("./aisdk-session.ts");
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const host = mockHost(async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({ ok: true, sessionId: "ses_h" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await hibernateAisdkSession("ses_h", host);
    expect(calls).toEqual([
      {
        url: "http://bridge.test/api/sessions/ses_h/hibernate",
        method: "POST",
        body: "{}",
      },
    ]);
  });

  test("404 is ignored", async () => {
    const { hibernateAisdkSession } = await import("./aisdk-session.ts");
    const host = mockHost(async () => new Response("gone", { status: 404 }));
    await hibernateAisdkSession("ses_missing", host);
  });

  test("other errors throw", async () => {
    const { hibernateAisdkSession, BridgeClientError } = await import(
      "./aisdk-session.ts"
    );
    const host = mockHost(async () =>
      new Response(
        JSON.stringify({
          error: { code: "internal_error", message: "boom" },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(hibernateAisdkSession("ses_bad", host)).rejects.toBeInstanceOf(
      BridgeClientError,
    );
  });
});

describe("session config REST helpers", () => {
  test("get / set mode / set model", async () => {
    const {
      getAisdkSessionConfig,
      getAisdkSessionModelConfig,
      setAisdkSessionConfigOption,
      setAisdkSessionMode,
      setAisdkSessionModel,
    } = await import("./aisdk-session.ts");
    const host = mockHost(async (input, init) => {
      const url = String(input);
      if (
        /\/api\/sessions\/[^/]+\/config$/.test(url) &&
        (!init?.method || init.method === "GET")
      ) {
        return new Response(
          JSON.stringify({
            sessionId: "ses_c",
            modes: [{ id: "build", name: "Build" }],
            models: [{ id: "m1", name: "Model 1" }],
            currentModeId: "build",
            currentModelId: "m1",
            nativeResume: true,
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
      if (url.endsWith("/config-option") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ configId: "reasoning_effort", value: "high" });
        return Response.json({
          models: [{ id: "m2", name: "Model 2" }],
          currentModelId: "m2",
          thoughtLevels: [
            { id: "low", name: "Low" },
            { id: "high", name: "High" },
          ],
          thoughtLevelConfigId: "reasoning_effort",
          currentThoughtLevelId: "high",
        });
      }
      const modelConfigMatch = url.match(
        /\/api\/sessions\/[^/]+\/models\/([^/]+)\/config$/,
      );
      if (modelConfigMatch && (!init?.method || init.method === "GET")) {
        const modelId = decodeURIComponent(modelConfigMatch[1]!);
        if (modelId === "m2") {
          return Response.json({
            modelId: "m2",
            thoughtLevels: [{ id: "high", name: "High" }],
            thoughtLevelConfigId: "reasoning_effort",
            currentThoughtLevelId: "high",
          });
        }
        if (modelId === "m1") {
          return Response.json({
            modelId: "m1",
            thoughtLevels: [{ id: "low", name: "Low" }],
            thoughtLevelConfigId: "reasoning_effort",
            currentThoughtLevelId: "low",
          });
        }
      }
      return new Response("nope", { status: 404 });
    });

    const cfg = await getAisdkSessionConfig("ses_c", host);
    expect(cfg.ready).toBe(true);
    expect(cfg.currentModeId).toBe("build");
    expect(cfg.modes[0]?.id).toBe("build");
    expect(cfg.nativeResume).toBe(true);

    const afterMode = await setAisdkSessionMode("ses_c", "plan", host);
    expect(afterMode.currentModeId).toBe("plan");

    const afterModel = await setAisdkSessionModel("ses_c", "m2", host);
    expect(afterModel.currentModelId).toBe("m2");

    const afterThought = await setAisdkSessionConfigOption(
      "ses_c",
      "reasoning_effort",
      "high",
      host,
    );
    expect(afterThought.currentThoughtLevelId).toBe("high");

    const modelCfg = await getAisdkSessionModelConfig("ses_c", "m2", host);
    expect(modelCfg.modelId).toBe("m2");
    expect(modelCfg.currentThoughtLevelId).toBe("high");

    const other = await getAisdkSessionModelConfig("ses_c", "m1", host);
    expect(other.modelId).toBe("m1");
    expect(other.thoughtLevels.map((item) => item.id)).toEqual(["low"]);
  });
});

describe("toAisdkSessionConfig axes", () => {
  test("parses context, thinking, and advertised modelConfigs", () => {
    const config = toAisdkSessionConfig({
      sessionId: "ses_x",
      models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
      currentModelId: "gpt-5.5",
      thoughtLevels: [{ id: "ultra", name: "Ultra" }],
      currentThoughtLevelId: "ultra",
      contextOptions: [{ id: "272k", name: "272k" }],
      currentContextId: "272k",
      thinkingOptions: [
        { id: "off", name: "Off" },
        { id: "on", name: "On" },
      ],
      currentThinkingId: "on",
      modelConfigs: {
        "gpt-5.5": {
          thoughtLevels: [{ id: "ultra", name: "Ultra" }],
          contextOptions: [{ id: "272k", name: "272k" }],
        },
        other: {
          thoughtLevels: [{ id: "xhigh", name: "Extra high" }],
        },
      },
    });
    expect(config.contextOptions.map((item) => item.id)).toEqual(["272k"]);
    expect(config.thinkingOptions.map((item) => item.id)).toEqual(["off", "on"]);
    expect(config.modelConfigs?.other?.thoughtLevels.map((item) => item.id)).toEqual([
      "xhigh",
    ]);
    expect(config.modelConfigs?.["gpt-5.5"]?.thoughtLevels[0]?.id).toBe("ultra");
  });

  test("splits none out of live thought into a thinking toggle", () => {
    const config = toAisdkSessionConfig({
      sessionId: "ses_x",
      models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
      currentModelId: "gpt-5.5",
      thoughtLevelConfigId: "reasoning",
      thoughtLevels: [
        { id: "none", name: "None" },
        { id: "low", name: "Low" },
        { id: "medium", name: "Medium" },
        { id: "high", name: "High" },
      ],
      currentThoughtLevelId: "medium",
      fastOptions: [
        { id: "false", name: "Off" },
        { id: "true", name: "On" },
      ],
    });
    expect(config.thoughtLevels.map((item) => item.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(config.thinkingOptions.map((item) => item.id)).toEqual(["none", "medium"]);
    expect(config.currentThinkingId).toBe("medium");
    expect(config.thinkingConfigId).toBe("reasoning");
  });
});
