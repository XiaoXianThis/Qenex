import { describe, expect, test } from "bun:test";
import {
  buildEditDiffLines,
  buildResultDiffLines,
  classifyTool,
  countDiffStats,
  detectToolCodeLanguage,
  fileBasename,
  fileExtLabel,
  formatResultText,
  genericArgEntries,
  parseToolArgs,
  parseUnifiedDiff,
  pickCommand,
  pickPath,
  pickPattern,
  prettifyToolCodeText,
  shouldDefaultToolPreview,
  shouldKeepToolExpanded,
  truncateText,
  unwrapAcpToolEnvelope,
} from "./tool-call-format.ts";
import { buildToolCallModel } from "./tool-call-view.tsx";

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

  test("Codex formatted_output", () => {
    expect(
      formatResultText({ formatted_output: "hello\nworld\n", exit_code: 0 }),
    ).toBe("hello\nworld\n");
    expect(
      formatResultText({ formatted_output: "boom", exit_code: 1 }),
    ).toBe("boom\nexit 1");
  });

  test("nested ACP content blocks", () => {
    expect(
      formatResultText([
        {
          type: "content",
          content: { type: "text", text: "search hit" },
        },
      ]),
    ).toBe("search hit");
  });

  test("diff objects become readable text", () => {
    expect(
      formatResultText({
        type: "diff",
        path: "a.ts",
        oldText: "old",
        newText: "new",
      }),
    ).toContain("a.ts");
  });
});

describe("unwrapAcpToolEnvelope", () => {
  test("unwraps provider { toolCallId, toolName, args }", () => {
    const { toolName, args } = unwrapAcpToolEnvelope({
      toolCallId: "exec-1",
      toolName: "Web search: foo",
      args: { query: "foo", type: "webSearch" },
    });
    expect(toolName).toBe("Web search: foo");
    expect(args).toEqual({ query: "foo", type: "webSearch" });
  });

  test("leaves flat args alone", () => {
    expect(unwrapAcpToolEnvelope({ path: "a.ts" })).toEqual({
      args: { path: "a.ts" },
    });
  });
});

describe("buildToolCallModel envelope", () => {
  test("Codex shell uses inner command + formatted_output", () => {
    const model = buildToolCallModel(
      "acp.acp_provider_agent_dynamic_tool",
      JSON.stringify({
        toolCallId: "t1",
        toolName: "pwd",
        args: { command: "pwd", cwd: "/tmp" },
      }),
      { formatted_output: "/tmp\n", exit_code: 0 },
    );
    expect(model.kind).toBe("shell");
    expect(model.command).toBe("pwd");
    expect(model.output).toBe("/tmp\n");
    expect(model.empty).toBe(false);
  });

  test("Codex web search with query is not an empty card", () => {
    const model = buildToolCallModel(
      "Web search",
      JSON.stringify({
        toolCallId: "t2",
        toolName: "Web search: DeepSeek",
        args: { type: "webSearch", query: "DeepSeek V4", action: {} },
      }),
      null,
    );
    expect(model.kind).toBe("grep");
    expect(pickPattern(model.args)).toBe("DeepSeek V4");
    expect(model.empty).toBe(false);
  });

  test("Cursor diff result fills edit body", () => {
    const model = buildToolCallModel(
      "Edit File",
      JSON.stringify({
        toolCallId: "t3",
        toolName: "Edit File",
        args: {},
      }),
      [
        {
          type: "diff",
          path: "/tmp/a.txt",
          oldText: "",
          newText: "hello",
        },
      ],
    );
    expect(model.kind).toBe("edit");
    expect(model.path).toBe("/tmp/a.txt");
    expect(model.diffLines.some((l) => l.kind === "add")).toBe(true);
    expect(model.empty).toBe(false);
  });

  test("apply_patch input is shown when not unified diff", () => {
    const lines = buildEditDiffLines({
      input: "*** Begin Patch\n*** Update File: a.ts\n+hi\n*** End Patch",
    });
    expect(lines.length).toBeGreaterThan(1);
    expect(buildResultDiffLines({ type: "diff", path: "a.ts", newText: "x" }).length).toBeGreaterThan(0);
  });
});

describe("detectToolCodeLanguage / prettifyToolCodeText", () => {
  test("detects JSON by shape", () => {
    expect(detectToolCodeLanguage('{"a":1}')).toBe("json");
    expect(detectToolCodeLanguage("[1,2]")).toBe("json");
    expect(detectToolCodeLanguage("plain text")).toBe("text");
  });

  test("shell kind uses bash", () => {
    expect(detectToolCodeLanguage("ls -la", { kind: "shell" })).toBe("bash");
  });

  test("path extension maps to language", () => {
    expect(detectToolCodeLanguage("", { path: "src/a.ts" })).toBe("typescript");
  });

  test("prettifyToolCodeText formats JSON", () => {
    const { text, language } = prettifyToolCodeText('{"a":1}');
    expect(language).toBe("json");
    expect(text).toBe('{\n  "a": 1\n}');
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
