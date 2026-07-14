import { describe, expect, test } from "bun:test";
import {
  classifyTool,
  countDiffStats,
  fileBasename,
  fileExtLabel,
  formatResultText,
  genericArgEntries,
  parseToolArgs,
  parseUnifiedDiff,
  pickCommand,
  pickPath,
  pickPattern,
  shouldDefaultToolPreview,
  shouldKeepToolExpanded,
  truncateText,
} from "./tool-call-format.ts";

describe("parseToolArgs", () => {
  test("parses object JSON", () => {
    expect(parseToolArgs('{"path":"a.ts"}')).toEqual({ path: "a.ts" });
  });

  test("incomplete JSON becomes _raw", () => {
    expect(parseToolArgs('{"path":"a')).toEqual({ _raw: '{"path":"a' });
  });

  test("empty → {}", () => {
    expect(parseToolArgs("")).toEqual({});
    expect(parseToolArgs(undefined)).toEqual({});
  });
});

describe("pickers", () => {
  test("pickPath prefers common keys", () => {
    expect(pickPath({ file_path: "src/a.ts" })).toBe("src/a.ts");
    expect(pickPath({ target_file: "b.ts" })).toBe("b.ts");
  });

  test("pickCommand joins nested command args", () => {
    expect(
      pickCommand({
        command: { command: "rg", args: ["-n", "foo"] },
      }),
    ).toBe("rg -n foo");
    expect(pickCommand({ command: "ls -la" })).toBe("ls -la");
  });

  test("pickPattern", () => {
    expect(pickPattern({ pattern: "TODO" })).toBe("TODO");
    expect(pickPattern({ query: "auth" })).toBe("auth");
  });
});

describe("classifyTool", () => {
  test("shell by command field", () => {
    expect(classifyTool("Run", { command: "bun test" })).toBe("shell");
  });

  test("grep by pattern", () => {
    expect(classifyTool("Search", { pattern: "foo", path: "src" })).toBe(
      "grep",
    );
  });

  test("edit by old/new string", () => {
    expect(
      classifyTool("StrReplace", {
        path: "a.ts",
        old_string: "a",
        new_string: "b",
      }),
    ).toBe("edit");
  });

  test("write by path + content", () => {
    expect(
      classifyTool("Write", { path: "a.ts", contents: "hi" }),
    ).toBe("write");
  });

  test("read by path only", () => {
    expect(classifyTool("Reading a.ts", { path: "a.ts" })).toBe("read");
  });

  test("name heuristics", () => {
    expect(classifyTool("bash", {})).toBe("shell");
    expect(classifyTool("Grep project", {})).toBe("grep");
  });
});

describe("shouldDefaultToolPreview", () => {
  test("shell / edit / write default to preview", () => {
    expect(shouldDefaultToolPreview("shell")).toBe(true);
    expect(shouldDefaultToolPreview("edit")).toBe(true);
    expect(shouldDefaultToolPreview("write")).toBe(true);
    expect(shouldKeepToolExpanded("shell")).toBe(true);
  });

  test("read / grep / generic default collapsed", () => {
    expect(shouldDefaultToolPreview("read")).toBe(false);
    expect(shouldDefaultToolPreview("grep")).toBe(false);
    expect(shouldDefaultToolPreview("generic")).toBe(false);
  });
});

describe("file helpers / diff", () => {
  test("fileBasename and ext label", () => {
    expect(fileBasename("src/foo/bar.ts")).toBe("bar.ts");
    expect(fileExtLabel("bar.ts")).toBe("TS");
    expect(fileExtLabel("Dockerfile")).toBe("FILE");
  });

  test("countDiffStats", () => {
    expect(
      countDiffStats([
        { kind: "add", text: "a", lineNo: 1, marker: "+" },
        { kind: "del", text: "b", lineNo: 1, marker: "-" },
        { kind: "ctx", text: "c", lineNo: 2, marker: " " },
      ]),
    ).toEqual({ additions: 1, deletions: 1 });
  });

  test("parseUnifiedDiff", () => {
    const lines = parseUnifiedDiff(
      "@@ -1,2 +1,2 @@\n-old\n+new\n context\n",
    );
    expect(lines).not.toBeNull();
    expect(lines!.some((l) => l.kind === "add" && l.text === "new")).toBe(true);
    expect(lines!.some((l) => l.kind === "del" && l.text === "old")).toBe(true);
  });
});

describe("formatResultText", () => {
  test("string passthrough", () => {
    expect(formatResultText("ok")).toBe("ok");
  });

  test("ACP text content blocks", () => {
    expect(
      formatResultText([{ type: "text", text: "line1" }, { text: "line2" }]),
    ).toBe("line1\nline2");
  });

  test("stdout/stderr object", () => {
    expect(
      formatResultText({ stdout: "out", stderr: "err" }),
    ).toBe("out\nerr");
  });
});

describe("genericArgEntries / truncate", () => {
  test("hides content keys", () => {
    const entries = genericArgEntries({
      path: "a.ts",
      content: "huge",
      timeout: 30,
    });
    expect(entries.map(([k]) => k).sort()).toEqual(["path", "timeout"]);
  });

  test("truncateText", () => {
    const { text, truncated } = truncateText("abcdef", 4);
    expect(truncated).toBe(true);
    expect(text.startsWith("abcd")).toBe(true);
  });
});
