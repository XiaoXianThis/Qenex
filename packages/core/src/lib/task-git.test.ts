import { describe, expect, test } from "bun:test";
import type {
  GitSessionBinding,
  GitTurnCommit,
  TaskGitResponse,
} from "./bridge-api.ts";

/** Shape guards for Plan B task-git payloads (camelCase from Bridge). */
function assertBinding(b: GitSessionBinding) {
  expect(typeof b.taskId).toBe("string");
  expect(typeof b.agentBranch).toBe("string");
  expect(typeof b.enabled).toBe("boolean");
  expect(b.agentBranch.startsWith("qenex/") || !b.enabled).toBe(true);
}

describe("task git API types", () => {
  test("parses enabled session status shape", () => {
    const payload = {
      binding: {
        taskId: "t1",
        cwd: "/tmp/proj",
        repoRoot: "/tmp/proj",
        baseBranch: "main",
        baseSha: "abc123",
        agentBranch: "qenex/t1",
        tipSha: "def456",
        enabled: true,
        preRewindSha: null,
      },
      files: [{ status: "A", path: "a.txt", additions: 1, deletions: 0 }],
      aheadOfBase: 1,
      dirty: false,
      turns: [
        {
          taskId: "t1",
          runId: "r1",
          commitSha: "def456",
          parentSha: "abc123",
          message: "qenex: turn r1",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ] satisfies GitTurnCommit[],
    } satisfies TaskGitResponse;

    assertBinding(payload.binding);
    expect(payload.files).toHaveLength(1);
    expect(payload.turns[0]!.commitSha).toBe("def456");
  });

  test("disabled binding still has agentBranch", () => {
    const binding: GitSessionBinding = {
      taskId: "x",
      cwd: "/tmp",
      repoRoot: "/tmp",
      baseBranch: null,
      baseSha: "",
      agentBranch: "qenex/x",
      tipSha: null,
      enabled: false,
      preRewindSha: null,
    };
    assertBinding(binding);
    expect(binding.enabled).toBe(false);
  });
});
