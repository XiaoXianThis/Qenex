import { describe, expect, test } from "bun:test";
import { ApprovalManager } from "../src/approval-manager.ts";
import { BridgeError } from "../src/errors.ts";
import { buildOpenCodeConfigContent } from "../src/opencode-config.ts";

const params = {
  sessionId: "ses_test",
  toolCall: {
    toolCallId: "call_test",
    title: "write phase3.txt",
    kind: "edit",
    rawInput: { filepath: "phase3.txt" },
  },
  options: [
    { optionId: "once", name: "Allow once", kind: "allow_once" },
    { optionId: "always", name: "Always allow", kind: "allow_always" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
};

describe("Phase 3 · ApprovalManager", () => {
  test("Ask queues a request and resolves the exact selected ACP option", async () => {
    const approvals = new ApprovalManager();
    approvals.setMode("ask");
    const responsePromise = approvals.handlePermissionRequest(params);

    const [pending] = approvals.list();
    expect(pending?.toolCall.title).toBe("write phase3.txt");
    expect(pending?.options.map((option) => option.optionId)).toEqual([
      "once",
      "always",
      "reject",
    ]);

    approvals.decide(pending!.approvalId, "reject");
    expect(await responsePromise).toEqual({
      outcome: { outcome: "selected", optionId: "reject" },
    });
    expect(approvals.list()).toEqual([]);
  });

  test("Auto chooses allow_once without creating a card", async () => {
    const approvals = new ApprovalManager();
    approvals.setMode("auto");
    expect(await approvals.handlePermissionRequest(params)).toEqual({
      outcome: { outcome: "selected", optionId: "once" },
    });
    expect(approvals.list()).toEqual([]);

    expect(
      await approvals.handlePermissionRequest({
        ...params,
        options: [
          { optionId: "reject", name: "Reject", kind: "reject_once" },
          { optionId: "always", name: "Always allow", kind: "allow_always" },
        ],
      }),
    ).toEqual({
      outcome: { outcome: "selected", optionId: "always" },
    });

    expect(
      await approvals.handlePermissionRequest({
        ...params,
        options: [
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      }),
    ).toEqual({ outcome: { outcome: "cancelled" } });
  });

  test("rejects option IDs that ACP did not offer", async () => {
    const approvals = new ApprovalManager();
    const responsePromise = approvals.handlePermissionRequest(params);
    const pending = approvals.list()[0]!;
    expect(() => approvals.decide(pending.approvalId, "invented")).toThrow(
      BridgeError,
    );
    approvals.cancelAll();
    expect(await responsePromise).toEqual({ outcome: { outcome: "cancelled" } });
  });
});

describe("Phase 3 · OpenCode inline permission config", () => {
  test("makes edit/bash/external_directory ask by default", () => {
    const config = JSON.parse(buildOpenCodeConfigContent()) as {
      permission: Record<string, unknown>;
    };
    expect(config.permission).toMatchObject({
      edit: "ask",
      bash: "ask",
      external_directory: "ask",
    });
  });

  test("preserves unrelated config and explicit granular allow/deny rules", () => {
    const config = JSON.parse(
      buildOpenCodeConfigContent(
        JSON.stringify({
          model: "provider/model",
          permission: {
            edit: { "*": "allow", "generated/**": "deny" },
            bash: { "*": "allow", "git status*": "allow", "rm *": "deny" },
          },
        }),
      ),
    ) as Record<string, any>;

    expect(config.model).toBe("provider/model");
    expect(config.permission.edit).toEqual({
      "*": "ask",
      "generated/**": "deny",
    });
    expect(config.permission.bash).toEqual({
      "*": "ask",
      "git status*": "allow",
      "rm *": "deny",
    });
  });

  test("never weakens a global deny", () => {
    const config = JSON.parse(
      buildOpenCodeConfigContent(JSON.stringify({ permission: "deny" })),
    );
    expect(config.permission).toBe("deny");

    const objectConfig = JSON.parse(
      buildOpenCodeConfigContent(
        JSON.stringify({ permission: { "*": "deny", read: "allow" } }),
      ),
    );
    expect(objectConfig.permission).toMatchObject({
      "*": "deny",
      read: "allow",
      edit: "deny",
      bash: "deny",
      external_directory: "deny",
    });
  });
});
