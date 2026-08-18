import { describe, expect, test } from "bun:test";
import { resolveShikiLang } from "./shiki-langs.ts";

describe("resolveShikiLang", () => {
  test("aliases common fences", () => {
    expect(resolveShikiLang("ts")).toBe("typescript");
    expect(resolveShikiLang("js")).toBe("javascript");
    expect(resolveShikiLang("md")).toBe("markdown");
    expect(resolveShikiLang("py")).toBe("python");
    expect(resolveShikiLang("rs")).toBe("rust");
    expect(resolveShikiLang("yml")).toBe("yaml");
    expect(resolveShikiLang("sh")).toBe("bash");
    expect(resolveShikiLang("c++")).toBe("cpp");
    expect(resolveShikiLang("docker")).toBe("dockerfile");
    expect(resolveShikiLang("console")).toBe("bash");
  });

  test("keeps preloaded langs", () => {
    expect(resolveShikiLang("tsx")).toBe("tsx");
    expect(resolveShikiLang("Go")).toBe("go");
    expect(resolveShikiLang("JSON")).toBe("json");
    expect(resolveShikiLang("java")).toBe("java");
    expect(resolveShikiLang("jsonc")).toBe("jsonc");
  });

  test("unknown langs fall back to text", () => {
    expect(resolveShikiLang("cobol")).toBe("text");
    expect(resolveShikiLang("")).toBe("text");
    expect(resolveShikiLang(undefined)).toBe("text");
  });
});
