import type {
  AgentId,
  BootstrapPayload,
  CollaborationMode,
  Deployment,
  ExecutorRun,
  GitDiffSummary,
  GitStatusSummary,
  TaskGraph,
  Thread,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = import.meta.env.VITE_AGENTHUB_API_URL || "";
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  bootstrap() {
    return request<BootstrapPayload>("/api/bootstrap");
  },
  createThread(title?: string) {
    return request<Thread>("/api/threads", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  },
  sendMessage(threadId: string, text: string, mode: CollaborationMode, agentId: AgentId) {
    return request<Thread>(`/api/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, mode, agentId }),
    });
  },
  generateTask(threadId: string, mode: CollaborationMode, agentId: AgentId) {
    return request<TaskGraph>("/api/task-graph/generate", {
      method: "POST",
      body: JSON.stringify({ threadId, mode, agentId }),
    });
  },
  toggleTask(taskId: string) {
    return request<TaskGraph>(`/api/task-graph/${taskId}/toggle`, {
      method: "POST",
    });
  },
  getDiff() {
    return request<GitDiffSummary>("/api/git/diff");
  },
  getStatus() {
    return request<GitStatusSummary>("/api/git/status");
  },
  runExecutor(command: string, threadId?: string, taskId?: string) {
    return request<ExecutorRun>("/api/executor/run", {
      method: "POST",
      body: JSON.stringify({ command, threadId, taskId }),
    });
  },
  deploy() {
    return request<Deployment>("/api/deployments/preview", {
      method: "POST",
    });
  },
  resetState() {
    return request<BootstrapPayload>("/api/state/reset", {
      method: "POST",
    });
  },
};
