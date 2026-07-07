export type RuntimeSessionConfig = {
  tabId: string;
  threadId: string;
  cwd: string;
  agentCommand: string[];
  agentSessionId?: string;
  shouldLoadHistory?: boolean;
};
