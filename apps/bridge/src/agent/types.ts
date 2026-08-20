/** Shared agent-domain types (camelCase; match packages/core bridge-api). */

export type AgentInstallKind = "binary" | "npx" | "uvx";
export type AgentReadiness =
  | "ready"
  | "needAdapter"
  | "needAuth"
  | "install"
  | "unavailable";
export type AgentDistributionClass = "native" | "adapter";
export type AgentDetectedSource = "path" | "vendor" | "managed" | "none";
export type CompatGrade =
  | "verified"
  | "experimental"
  | "standard-acp"
  | "unsupported";

export type InstalledAgentInfo = {
  agentId: string;
  name: string;
  version: string;
  kind: AgentInstallKind;
  command: string[];
  env?: Record<string, string>;
  installPath: string;
  installedAt: number;
};

export type PackageDistribution = {
  package: string;
  args?: string[];
  env?: Record<string, string>;
};

export type BinaryTarget = {
  archive: string;
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
};

export type RegistryAgentRaw = {
  id: string;
  name: string;
  version: string;
  description: string;
  repository?: string | null;
  website?: string | null;
  authors?: string[];
  license?: string | null;
  icon?: string | null;
  distribution: {
    binary?: Record<string, BinaryTarget> | null;
    npx?: PackageDistribution | null;
    uvx?: PackageDistribution | null;
  };
};

export type RegistryDocument = {
  version: string;
  agents: RegistryAgentRaw[];
};

export type InstallPlan = {
  kind: AgentInstallKind;
  binary?: BinaryTarget;
  package?: PackageDistribution;
};

export type AgentStatus = {
  readiness: AgentReadiness;
  distributionClass: AgentDistributionClass;
  detected: AgentDetectedSource;
  resolvedCommand?: string[] | null;
  updateAvailable: boolean;
  installable: boolean;
  preferredKind?: AgentInstallKind | null;
  managed?: InstalledAgentInfo | null;
  detail?: string | null;
  authHint?: string | null;
};

export type DiscoveredAgentEntry = {
  id: string;
  name: string;
  version: string;
  readiness: AgentReadiness;
  detected: AgentDetectedSource;
  resolvedCommand?: string[] | null;
  updateAvailable: boolean;
  detail?: string | null;
  authHint?: string | null;
  icon?: string | null;
  compatGrade?: CompatGrade;
};

export type RegistryAgentEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  repository?: string | null;
  website?: string | null;
  authors?: string[];
  license?: string | null;
  icon?: string | null;
  platform: string;
  installable: boolean;
  preferredKind?: AgentInstallKind | null;
  distributionClass?: AgentDistributionClass;
  readiness?: AgentReadiness;
  detected?: AgentDetectedSource;
  resolvedCommand?: string[] | null;
  detail?: string | null;
  authHint?: string | null;
  installed?: InstalledAgentInfo | null;
  updateAvailable: boolean;
  host?: null;
  compatGrade?: CompatGrade;
};

export type EnsureReadyResult = {
  agentId: string;
  readiness: AgentReadiness;
  skippedDownload: boolean;
  source: AgentDetectedSource;
  updateAvailable: boolean;
  resolvedCommand?: string[] | null;
  installed?: InstalledAgentInfo | null;
  authHint?: string | null;
  detail?: string | null;
};

export type ProgressEvent =
  | { type: "stage"; stage: string; message: string }
  | {
      type: "download";
      message: string;
      url?: string;
      downloadedBytes: number;
      totalBytes?: number | null;
    }
  | {
      type: "done";
      agent?: InstalledAgentInfo;
      result?: EnsureReadyResult;
      host?: unknown;
    }
  | { type: "error"; detail: string };

export type ProgressEmit = (event: ProgressEvent) => void;

export type ResolvedLaunch = {
  agentId: string;
  command: string[];
  env?: Record<string, string>;
};
