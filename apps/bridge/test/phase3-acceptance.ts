/**
 * Live Phase 3 acceptance against OpenCode ACP:
 * Ask reject -> no file; Ask approve -> stream resumes and file exists;
 * Auto -> no pending card and file exists.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridgeServer } from "../src/server.ts";
import type { PendingApproval } from "../src/approval-manager.ts";

const workspace = mkdtempSync(join(tmpdir(), "qenex-phase3-"));
const dbPath = join(mkdtempSync(join(tmpdir(), "qenex-phase3-db-")), "sessions.db");
const server = startBridgeServer({ hostname: "127.0.0.1", port: 0, dbPath });

type ApprovalList = { approvals: PendingApproval[] };

async function createSession(): Promise<string> {
  const response = await fetch(`${server.url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: workspace }),
  });
  const body = (await response.json()) as {
    sessionId?: string;
    error?: { message?: string };
  };
  if (response.status !== 201 || !body.sessionId) {
    throw new Error(`session creation failed: ${JSON.stringify(body)}`);
  }
  return body.sessionId;
}

async function startChat(
  sessionId: string,
  approvalMode: "ask" | "auto",
  text: string,
): Promise<{ stream: Promise<string> }> {
  const response = await fetch(`${server.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      approvalMode,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`chat start failed (${response.status}): ${await response.text()}`);
  }
  return { stream: response.text() };
}

async function pending(sessionId: string): Promise<PendingApproval[]> {
  const response = await fetch(
    `${server.url}/api/sessions/${sessionId}/approvals`,
  );
  if (!response.ok) {
    throw new Error(`approval poll failed (${response.status})`);
  }
  return ((await response.json()) as ApprovalList).approvals;
}

function optionFor(
  approval: PendingApproval,
  decision: "allow" | "reject",
): string {
  const option = approval.options.find((candidate) => {
    if (candidate.kind) {
      return decision === "allow"
        ? /^allow/i.test(candidate.kind)
        : /^reject/i.test(candidate.kind);
    }
    return decision === "allow"
      ? /allow|approve|yes/i.test(`${candidate.optionId} ${candidate.name}`) ||
          /^(once|always)$/i.test(candidate.optionId)
      : /reject|deny|cancel|no/i.test(`${candidate.optionId} ${candidate.name}`);
  });
  if (!option) {
    throw new Error(
      `No ${decision} option in ${JSON.stringify(approval.options)}`,
    );
  }
  return option.optionId;
}

async function decide(
  sessionId: string,
  approval: PendingApproval,
  decision: "allow" | "reject",
): Promise<void> {
  const optionId = optionFor(approval, decision);
  const response = await fetch(
    `${server.url}/api/sessions/${sessionId}/approvals/${approval.approvalId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionId }),
    },
  );
  if (!response.ok) {
    throw new Error(`approval response failed (${response.status})`);
  }
}

async function settleAskTurn(
  sessionId: string,
  stream: Promise<string>,
  decideFor: "allow" | "reject" | ((approval: PendingApproval) => "allow" | "reject"),
  timeoutMs = 180_000,
): Promise<{
  body: string;
  handled: Array<{ approval: PendingApproval; decision: "allow" | "reject" }>;
}> {
  let finished = false;
  let streamError: unknown;
  let body = "";
  void stream.then(
    (value) => {
      body = value;
      finished = true;
    },
    (error) => {
      streamError = error;
      finished = true;
    },
  );

  const handled = new Set<string>();
  const decisions: Array<{
    approval: PendingApproval;
    decision: "allow" | "reject";
  }> = [];
  const deadline = Date.now() + timeoutMs;
  while (!finished && Date.now() < deadline) {
    for (const approval of await pending(sessionId)) {
      if (handled.has(approval.approvalId)) continue;
      handled.add(approval.approvalId);
      const decision =
        typeof decideFor === "function" ? decideFor(approval) : decideFor;
      decisions.push({ approval, decision });
      console.log(
        `[phase3] ${decision}`,
        approval.toolCall.kind,
        approval.toolCall.title,
      );
      await decide(sessionId, approval, decision);
    }
    await Bun.sleep(100);
  }
  if (!finished) throw new Error("Ask turn timed out");
  if (streamError) throw streamError;
  return { body, handled: decisions };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("operation timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

try {
  const sessionId = await createSession();
  console.log("[phase3] session", sessionId, "workspace", workspace);

  const rejectedFile = join(workspace, "ask-rejected.txt");
  const { stream: rejectedStream } = await startChat(
    sessionId,
    "ask",
    `Use the write or edit tool now to create ${rejectedFile} with exactly ASK_REJECTED. Do not use bash and do not merely explain.`,
  );
  const rejected = await settleAskTurn(sessionId, rejectedStream, "reject");
  if (rejected.handled.length < 1) {
    throw new Error("Ask reject turn did not produce an ACP permission request");
  }
  if (existsSync(rejectedFile)) {
    throw new Error("Rejected edit was executed");
  }

  const commandFile = join(workspace, "ask-command-rejected.txt");
  const { stream: commandStream } = await startChat(
    sessionId,
    "ask",
    `Use the bash tool now to run exactly: printf COMMAND_REJECTED > '${commandFile}'. Do not use write or edit and do not merely explain.`,
  );
  const command = await settleAskTurn(
    sessionId,
    commandStream,
    (approval) => {
      const summary = `${approval.toolCall.kind ?? ""} ${approval.toolCall.title ?? ""} ${JSON.stringify(approval.toolCall.rawInput)}`;
      return /execute|bash|printf|COMMAND_REJECTED/i.test(summary)
        ? "reject"
        : "allow";
    },
  );
  const rejectedCommand = command.handled.some(({ approval, decision }) => {
    const summary = `${approval.toolCall.kind ?? ""} ${approval.toolCall.title ?? ""} ${JSON.stringify(approval.toolCall.rawInput)}`;
    return decision === "reject" && /execute|bash|printf|COMMAND_REJECTED/i.test(summary);
  });
  if (!rejectedCommand) {
    throw new Error("Ask command turn did not surface a bash/execute approval");
  }
  if (existsSync(commandFile)) {
    throw new Error("Rejected command was executed");
  }

  const approvedFile = join(workspace, "ask-approved.txt");
  const { stream: approvedStream } = await startChat(
    sessionId,
    "ask",
    `Use the write or edit tool now to create ${approvedFile} with exactly ASK_APPROVED. Do not use bash and do not merely explain.`,
  );
  const approved = await settleAskTurn(sessionId, approvedStream, "allow");
  if (approved.handled.length < 1) {
    throw new Error("Ask approve turn did not produce an ACP permission request");
  }
  if (!existsSync(approvedFile) || !readFileSync(approvedFile, "utf8").includes("ASK_APPROVED")) {
    throw new Error("Approved edit did not execute");
  }

  const autoFile = join(workspace, "auto-approved.txt");
  const { stream: autoStream } = await startChat(
    sessionId,
    "auto",
    `Use the write or edit tool now to create ${autoFile} with exactly AUTO_APPROVED. Do not use bash and do not merely explain.`,
  );
  await withTimeout(autoStream, 180_000);
  if (!existsSync(autoFile) || !readFileSync(autoFile, "utf8").includes("AUTO_APPROVED")) {
    throw new Error("Auto edit did not execute");
  }
  if ((await pending(sessionId)).length !== 0) {
    throw new Error("Auto mode left a pending approval card");
  }

  console.log("PHASE3_ACCEPTANCE_OK", {
    askRejectApprovals: rejected.handled.length,
    askCommandApprovals: command.handled.length,
    askApproveApprovals: approved.handled.length,
    autoPending: 0,
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server.stop();
  rmSync(workspace, { recursive: true, force: true });
}
