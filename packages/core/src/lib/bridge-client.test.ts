import { describe, expect, test } from "bun:test";
import type { QenexHost } from "@qenex/platform";
import {
  BridgeApiError,
  clearBridgeHost,
  fetchJson,
  isAuthRequiredError,
  isInteractiveAuthMethod,
  setBridgeHost,
  stringifyErrorMessage,
} from "./bridge-client.ts";

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

describe("stringifyErrorMessage", () => {
  test("extracts nested objects instead of [object Object]", () => {
    expect(stringifyErrorMessage("[object Object]")).toBe("");
    expect(stringifyErrorMessage({ message: "hello" })).toBe("hello");
    expect(stringifyErrorMessage({ error: { message: "inner" } })).toBe("inner");
    expect(stringifyErrorMessage({ foo: 1 })).toBe('{"foo":1}');
  });
});

describe("isInteractiveAuthMethod", () => {
  test("treats cursor_login and oauth as interactive", () => {
    expect(
      isInteractiveAuthMethod({
        id: "cursor_login",
        type: "cursor_login",
        name: "Cursor Login",
      }),
    ).toBe(true);
    expect(
      isInteractiveAuthMethod({
        id: "oauth-personal",
        type: "oauth",
        name: "Google",
      }),
    ).toBe(true);
    expect(
      isInteractiveAuthMethod({
        id: "api_key",
        type: "api_key",
        name: "API Key",
      }),
    ).toBe(false);
  });
});

describe("fetchJson auth envelope", () => {
  test("lifts nested error.message objects and details.methods", async () => {
    setBridgeHost(
      mockHost(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: "auth_required",
              message: { info: "gemini requires authentication" },
              details: {
                methods: [{ id: "google_login", type: "browser", name: "Google" }],
                agentName: "gemini",
              },
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }),
    );
    try {
      let caught: unknown;
      try {
        await fetchJson("/api/sessions");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BridgeApiError);
      const api = caught as BridgeApiError;
      expect(api.message).not.toBe("[object Object]");
      expect(api.code).toBe("auth_required");
      expect(isAuthRequiredError(api)).toBe(true);
      const auth = api.asAuthRequired();
      expect(auth?.methods[0]?.id).toBe("google_login");
      expect(auth?.agentName).toBe("gemini");
    } finally {
      clearBridgeHost();
    }
  });
});
