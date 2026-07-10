export type RuntimeSessionConfig = {
  tabId: string;
  threadId: string;
  agentId: string;
  cwd: string;
  /** Optional override; empty lets Bridge resolve from agentId. */
  agentCommand?: string[];
  agentSessionId?: string;
  shouldLoadHistory?: boolean;
};
