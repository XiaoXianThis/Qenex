import { describe, expect, test } from "bun:test";
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";
import { BridgeError } from "../src/errors.ts";
import { initProviderSessionWithInteractiveAuth } from "../src/session-store.ts";
import {
  cliLoginCommand,
  pickInteractiveAuthMethodId,
} from "../src/agent/compat/types.ts";
import { cursorCompat } from "../src/agent/compat/cursor.ts";

function fakeProvider(input: {
  inits: Array<() => Promise<{ sessionId: string }>>;
  auth?: (methodId?: string) => Promise<void>;
  authMethods?: unknown[];
}): ACPProvider {
  let i = 0;
  return {
    initSession: async () => {
      const fn = input.inits[Math.min(i, input.inits.length - 1)]!;
      i += 1;
      return fn();
    },
    authenticate: input.auth ?? (async () => {}),
    languageModel: () => ({
      availableAuthMethodIds: input.authMethods ?? [],
    }),
  } as unknown as ACPProvider;
}

describe("pickInteractiveAuthMethodId", () => {
  test("prefers cursor_login over later methods", () => {
    expect(
      pickInteractiveAuthMethodId([
        { id: "api_key", name: "API Key" },
        { id: "cursor_login", name: "Cursor Login" },
      ]),
    ).toBe("cursor_login");
  });

  test("prefers oauth-personal for Gemini-style lists", () => {
    expect(
      pickInteractiveAuthMethodId([
        { id: "gemini-login", type: "terminal", name: "Gemini CLI login" },
        { id: "oauth-personal", name: "Google" },
      ]),
    ).toBe("oauth-personal");
  });

  test("returns null when empty", () => {
    expect(pickInteractiveAuthMethodId([])).toBeNull();
    expect(pickInteractiveAuthMethodId(undefined)).toBeNull();
  });
});

describe("cliLoginCommand", () => {
  test("prepends the launch binary to loginArgv", () => {
    expect(cliLoginCommand(["agent", "acp"], ["login"])).toEqual([
      "agent",
      "login",
    ]);
    expect(cliLoginCommand(["cursor-agent", "acp"], cursorCompat.loginArgv)).toEqual(
      ["cursor-agent", "login"],
    );
    expect(cliLoginCommand([], ["login"])).toBeNull();
  });
});

describe("initProviderSessionWithInteractiveAuth", () => {
  test("Cursor auth_required spawns CLI login then respawns ACP", async () => {
    const logins: string[][] = [];
    let authed = 0;
    const first = fakeProvider({
      inits: [
        async () => {
          throw { code: -32603, message: "Internal error" };
        },
      ],
      auth: async () => {
        authed += 1;
      },
      authMethods: ["cursor_login"],
    });
    const second = fakeProvider({
      inits: [async () => ({ sessionId: "ses_ok" })],
    });
    const result = await initProviderSessionWithInteractiveAuth({
      provider: first,
      agentId: "cursor-agent",
      launchCommand: ["agent", "acp"],
      runLogin: async (command) => {
        logins.push(command);
      },
      respawn: () => second,
    });
    expect(logins).toEqual([["agent", "login"]]);
    expect(authed).toBe(0);
    expect(result.session.sessionId).toBe("ses_ok");
    expect(result.provider).toBe(second);
  });

  test("Gemini without loginArgv does not call authenticate a second time", async () => {
    const authed: string[] = [];
    let inits = 0;
    await expect(
      initProviderSessionWithInteractiveAuth({
        provider: fakeProvider({
          inits: [
            async () => {
              inits += 1;
              throw new Error("authentication required");
            },
          ],
          auth: async (methodId) => {
            authed.push(methodId ?? "");
          },
          authMethods: ["oauth-personal"],
        }),
        agentId: "gemini",
        launchCommand: ["gemini", "--experimental-acp"],
      }),
    ).rejects.toMatchObject({ code: "auth_required" });
    expect(authed).toEqual([]);
    expect(inits).toBe(1);
  });

  test("does not authenticate on session_init_timeout even with auth methods", async () => {
    let authed = 0;
    let logins = 0;
    await expect(
      initProviderSessionWithInteractiveAuth({
        provider: fakeProvider({
          inits: [
            async () => {
              throw new BridgeError(
                "session_init_timeout",
                "Agent did not initialize within 90000ms",
                504,
              );
            },
          ],
          auth: async () => {
            authed += 1;
          },
          authMethods: ["oauth-personal"],
        }),
        agentId: "gemini",
        launchCommand: ["gemini", "--experimental-acp"],
        runLogin: async () => {
          logins += 1;
        },
      }),
    ).rejects.toMatchObject({ code: "session_init_timeout" });
    expect(authed).toBe(0);
    expect(logins).toBe(0);
  });

  test("does not login on spawn failures", async () => {
    let logins = 0;
    await expect(
      initProviderSessionWithInteractiveAuth({
        provider: fakeProvider({
          inits: [
            async () => {
              throw new Error("spawn ENOENT: failed to start process");
            },
          ],
        }),
        agentId: "cursor-agent",
        launchCommand: ["agent", "acp"],
        runLogin: async () => {
          logins += 1;
        },
      }),
    ).rejects.toMatchObject({ code: "agent_spawn_failed" });
    expect(logins).toBe(0);
  });

  test("keeps auth_required when CLI login succeeds but session/new still fails", async () => {
    await expect(
      initProviderSessionWithInteractiveAuth({
        provider: fakeProvider({
          inits: [
            async () => {
              throw { code: -32603, message: "Internal error" };
            },
          ],
          authMethods: ["cursor_login"],
        }),
        agentId: "cursor-agent",
        launchCommand: ["agent", "acp"],
        runLogin: async () => {},
        respawn: () =>
          fakeProvider({
            inits: [
              async () => {
                throw { code: -32603, message: "Internal error" };
              },
            ],
          }),
      }),
    ).rejects.toMatchObject({ code: "auth_required" });
  });
});
