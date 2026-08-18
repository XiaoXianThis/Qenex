import { describe, expect, test } from "bun:test";
import { cleanEnv } from "../src/agent/spawn.ts";
import { opencodeCompat } from "../src/agent/compat/opencode.ts";
import { buildOpenCodeConfigContent } from "../src/opencode-config.ts";

describe("cleanEnv", () => {
  test("does not copy unrelated parent env into the child", () => {
    const leakKey = "QENEX_TEST_HUGE_ENV_LEAK";
    process.env[leakKey] = "x".repeat(10_000);
    try {
      const env = cleanEnv({ OPENCODE_CONFIG_CONTENT: "{}" });
      expect(env?.[leakKey]).toBeUndefined();
      expect(env?.OPENCODE_CONFIG_CONTENT).toBe("{}");
      expect(env?.PATH ?? process.env.PATH).toBeTruthy();
      if (process.env.HOME) expect(env?.HOME).toBe(process.env.HOME);
    } finally {
      delete process.env[leakKey];
    }
  });

  test("copies parent API keys that agents read from env", () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-parent";
    try {
      const env = cleanEnv();
      expect(env?.OPENAI_API_KEY).toBe("sk-test-parent");
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  test("compat extra OPENAI_API_KEY is not dropped", () => {
    const env = cleanEnv({ OPENAI_API_KEY: "sk-from-compat" });
    expect(env?.OPENAI_API_KEY).toBe("sk-from-compat");
  });

  test("keeps ACP_AI_PROVIDER_DEBUG and LANG when present", () => {
    const prevDebug = process.env.ACP_AI_PROVIDER_DEBUG;
    const prevLang = process.env.LANG;
    process.env.ACP_AI_PROVIDER_DEBUG = "1";
    process.env.LANG = "en_US.UTF-8";
    try {
      const env = cleanEnv();
      expect(env?.ACP_AI_PROVIDER_DEBUG).toBe("1");
      expect(env?.LANG).toBe("en_US.UTF-8");
    } finally {
      if (prevDebug === undefined) delete process.env.ACP_AI_PROVIDER_DEBUG;
      else process.env.ACP_AI_PROVIDER_DEBUG = prevDebug;
      if (prevLang === undefined) delete process.env.LANG;
      else process.env.LANG = prevLang;
    }
  });

  test("preserves OpenCode compat launch env", () => {
    const patch = opencodeCompat.augmentLaunch?.({
      cwd: "/tmp",
      agentId: "opencode",
      command: ["opencode", "acp"],
    });
    const env = cleanEnv({
      ...(patch?.env ?? {}),
    });
    expect(env?.OPENCODE_CONFIG_CONTENT).toBe(
      buildOpenCodeConfigContent(process.env.OPENCODE_CONFIG_CONTENT),
    );
  });
});
