import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

describe("turn streaming caret layout", () => {
  test("reserves a fixed line and fades visibility instead of unmounting", () => {
    const css = readFileSync(join(root, "../../index.css"), "utf8");
    expect(css).toContain('.aui-md[data-status="running"] > :last-child::after');
    expect(css).toContain("content: none !important");
    expect(css).toContain(".aui-turn-caret {");
    expect(css).toContain("height: 1.25em");
    expect(css).toContain("transition: opacity 200ms ease");
    expect(css).toContain("aui-turn-caret-pulse");
    expect(css).toContain("ease-in-out infinite");
    expect(css).not.toMatch(/\.aui-turn-caret-dot[\s\S]*step-end/);
    expect(css).not.toContain('[data-layout="overlay"]');
  });

  test("markdown does not drive data-status=running", () => {
    const md = readFileSync(join(root, "markdown-text.tsx"), "utf8");
    expect(md).toContain('"data-status": "complete"');
    expect(md).not.toContain('smooth ? "running"');
  });

  test("caret stays mounted; AUI indicator part is ignored", () => {
    const caret = readFileSync(join(root, "turn-streaming-caret.tsx"), "utf8");
    expect(caret).toContain("visible: boolean");
    expect(caret).toContain("data-visible");

    const thread = readFileSync(join(root, "thread.tsx"), "utf8");
    expect(thread).toContain("<TurnStreamingCaret visible={caretVisible} />");
    expect(thread).toContain(
      "<TurnStreamingCaret visible={Boolean(caretVisible)} />",
    );
    expect(thread).toContain('indicator="never"');
    expect(thread).toContain("isDuplicateLiveAssistant");
    expect(thread).toMatch(/case "indicator":[\s\S]*return null/);
    expect(thread).not.toContain('layout="overlay"');
  });
});
