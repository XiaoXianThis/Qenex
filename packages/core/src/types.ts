export type RuntimeSessionConfig = {
  tabId: string;
  threadId: string;
  agentId: string;
  cwd: string;
  agentCommand: string[];
  agentSessionId?: string;
  shouldLoadHistory?: boolean;
};
