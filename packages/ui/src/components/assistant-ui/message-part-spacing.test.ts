import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const readComponent = (name: string) =>
  readFileSync(join(root, name), "utf8");

describe("assistant message part spacing", () => {
  test("the message owns spacing between text, reasoning, and tools", () => {
    const thread = readComponent("thread.tsx");
    expect(thread).toContain('data-slot="aui_assistant-message-parts"');
    expect(thread).toContain('className="flex flex-col gap-y-2"');
  });

  test("collapsible parts do not add competing outer margins", () => {
    const reasoning = readComponent("reasoning.tsx");
    const toolGroup = readComponent("tool-group.tsx");
    const toolFallback = readComponent("tool-fallback.tsx");

    expect(reasoning).toContain('cva("aui-reasoning-root w-full"');
    expect(toolGroup).toContain(
      'cva("aui-tool-group-root group/tool-group w-full"',
    );
    expect(toolFallback).toContain(
      '"aui-tool-fallback-root group/tool-fallback-root w-full"',
    );
  });

  test("expanded reasoning and tool content share the text left edge", () => {
    const reasoning = readComponent("reasoning.tsx");
    const toolFallback = readComponent("tool-fallback.tsx");

    expect(reasoning).toContain("overflow-y-auto py-1 leading-relaxed");
    expect(reasoning).not.toContain("overflow-y-auto ps-0.5");
    expect(toolFallback).toContain(
      'compact ? "" : "flex flex-col gap-2 py-1"',
    );
  });

  test("collapsible headers share a safe line height and semantic icons", () => {
    const trigger = readComponent("collapsible-part-trigger.tsx");
    const reasoning = readComponent("reasoning.tsx");
    const toolGroup = readComponent("tool-group.tsx");
    const toolFallback = readComponent("tool-fallback.tsx");

    expect(trigger).toContain("min-h-7");
    expect(trigger).toContain("text-sm leading-5");
    expect(trigger).not.toContain("truncate leading-none");
    expect(reasoning).toContain("icon={BrainCircuitIcon}");
    expect(toolGroup).toContain("icon={WrenchIcon}");
    expect(toolFallback).toContain("icon={WrenchIcon}");
  });
});
