import { describe, expect, test } from "bun:test";
import { compatGradeFor } from "../src/agent/compat/grades.ts";

describe("compatGradeFor", () => {
  test("verified agents", () => {
    expect(compatGradeFor("opencode")).toBe("verified");
    expect(compatGradeFor("cursor-agent")).toBe("verified");
    expect(compatGradeFor("cursor")).toBe("verified");
    expect(compatGradeFor("claude-acp")).toBe("verified");
    expect(compatGradeFor("claude")).toBe("verified");
    expect(compatGradeFor("codex-acp")).toBe("verified");
    expect(compatGradeFor("codex")).toBe("verified");
  });

  test("experimental agents and aliases", () => {
    expect(compatGradeFor("pi-acp")).toBe("experimental");
    expect(compatGradeFor("pi")).toBe("experimental");
    expect(compatGradeFor("qoder")).toBe("experimental");
    expect(compatGradeFor("qodercli")).toBe("experimental");
  });

  test("unlisted registry ids default to standard-acp", () => {
    expect(compatGradeFor("gemini")).toBe("standard-acp");
    expect(compatGradeFor("some-new-registry-agent")).toBe("standard-acp");
  });
});
