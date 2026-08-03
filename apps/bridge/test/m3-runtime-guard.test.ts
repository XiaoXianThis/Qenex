/**
 * M3 guards: files API, @ autocomplete, rich Thread UI (no AisdkThreadMessages primary path).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("M3 · Bridge files API", () => {
  test("files module and route exist", () => {
    expect(existsSync(resolve(repoRoot, "apps/bridge/src/files.ts"))).toBe(true);
    const server = read("apps/bridge/src/server.ts");
    expect(server).toContain('pathname === "/api/files"');
    expect(server).toContain("listWorkspaceFiles");
  });
});

describe("M3 · frontend wiring", () => {
  test("ComposerAutocomplete is mounted on ThreadComposer", () => {
    const thread = read("packages/ui/src/components/assistant-ui/thread.tsx");
    expect(thread).toContain("ComposerAutocomplete");
    expect(thread).toContain("ComposerPrimitive.Root");
    expect(thread).toContain("useAui");
    expect(thread).toContain("ChatStreamErrorBanner");
    expect(thread).toContain("ChatRunStatusBanner");
    expect(thread).toContain("MessageByIndexProvider");
    expect(thread).toContain("LiveUserMessage");
    // Local draft under useAISDKRuntime; text sends via useChat for optimistic UI.
    expect(thread).toContain('useState("")');
    expect(thread).toContain("chat.sendMessage");
    expect(thread).toContain("composer.setText(text)");
    expect(thread).toContain("composer.send()");
  });

  test("ComposerAutocomplete is controlled by parent draft", () => {
    const auto = read(
      "packages/ui/src/components/assistant-ui/composer-autocomplete.tsx",
    );
    expect(auto).toContain("listWorkspaceFiles");
    expect(auto).toContain("value: composerText");
    expect(auto).toContain("onChange: setText");
    expect(auto).not.toContain("unstable_useComposerInput");
  });

  test("ActiveThreadLayout uses ThreadMessagesArea (rich UI)", () => {
    const layout = read("packages/ui/src/layout/puck/ActiveThreadLayout.tsx");
    expect(layout).toContain("ThreadMessagesArea");
    expect(layout).toContain("ChatStreamErrorBanner");
    expect(layout).toContain("ChatRunStatusBanner");
    expect(layout).not.toContain("OptimisticUserBubble");
    expect(layout).not.toContain("<AisdkThreadMessages");
    // Must not gate the live message list on isNewChatView (breaks optimistic user bubble).
    expect(layout).not.toMatch(
      /AuiIf condition=\{\(s\) => !isNewChatView\(s\)\}>\s*\n\s*<ThreadMessagesArea/,
    );
  });

  test("runtime injects composer attachment adapter", () => {
    const src = read("packages/ui/src/components/AgentRuntimeProvider.tsx");
    expect(src).toContain("createComposerAttachmentAdapter");
    expect(src).toContain("adapters: { attachments:");
  });

  test("message metadata parse + artifacts UI exist", () => {
    expect(
      existsSync(resolve(repoRoot, "packages/core/src/lib/message-metadata.ts")),
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          repoRoot,
          "packages/ui/src/components/assistant-ui/message-artifacts.tsx",
        ),
      ),
    ).toBe(true);
    const thread = read("packages/ui/src/components/assistant-ui/thread.tsx");
    expect(thread).toContain("AssistantMessageArtifacts");
    expect(thread).toContain("MessageArtifacts");
  });
});
