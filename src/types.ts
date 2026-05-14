export type AgentId = "pm" | "arch" | "fe" | "qa" | "ops" | "code";

export type CollaborationMode = "group" | "single";

export type Agent = {
  id: AgentId;
  name: string;
  role: string;
  initials: string;
  color: string;
  tools: string[];
};

export type Message = {
  id: string;
  agentId?: AgentId;
  user?: true;
  text: string;
  chips: string[];
  toolSuggestions?: ToolSuggestion[];
  createdAt: string;
};

export type ToolSuggestion = {
  id: string;
  command: string;
  title: string;
  reason: string;
  status: "suggested" | "accepted" | "dismissed";
};

export type Thread = {
  id: string;
  title: string;
  mode: CollaborationMode;
  messages: Message[];
};

export type TaskNode = {
  id: string;
  title: string;
  owner: string;
  detail: string;
  status: "done" | "running" | "todo" | "blocked";
  dependsOn: string[];
  source?: "agent" | "manual";
  updatedAt?: string;
  acceptanceCommand?: string;
};

export type TaskGraph = {
  id: string;
  updatedAt: string;
  nodes: TaskNode[];
};

export type GitDiffSummary = {
  available: boolean;
  filesChanged: number;
  insertions: number;
  deletions: number;
  raw: string;
  status?: GitStatusSummary;
  error?: string;
};

export type GitStatusEntry = {
  code: string;
  path: string;
  kind: "tracked" | "untracked";
  scope: "workspace" | "external";
};

export type GitStatusSummary = {
  available: boolean;
  clean: boolean;
  raw: string;
  entries: GitStatusEntry[];
  counts: {
    total: number;
    tracked: number;
    untracked: number;
    external: number;
  };
  untracked: GitStatusEntry[];
  error?: string;
};

export type ExecutorRun = {
  id: string;
  command: string;
  taskId?: string;
  status: "queued" | "running" | "success" | "failed";
  output: string;
  startedAt: string;
  finishedAt?: string;
};

export type Deployment = {
  id: string;
  status: "idle" | "building" | "live" | "failed";
  url?: string;
  logs: string[];
  updatedAt: string;
};

export type Artifact = {
  id: string;
  kind: "diff" | "test" | "build" | "preview" | "document" | "log";
  title: string;
  summary: string;
  source: string;
  status: "ready" | "running" | "failed";
  ref?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type OrchestratorStatus = {
  provider: "openai" | "aigo" | "fallback";
  configured: boolean;
  model: string;
  fallbackModel: string;
  reasoningEffort: string;
  apiStyle?: "responses" | "chat";
  baseUrl?: string;
};

export type BootstrapPayload = {
  agents: Agent[];
  threads: Thread[];
  taskGraph: TaskGraph;
  artifacts: Artifact[];
  diff: GitDiffSummary;
  executorRuns: ExecutorRun[];
  deployment: Deployment;
  orchestrator: OrchestratorStatus;
};
