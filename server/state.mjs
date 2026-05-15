import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const dataDir = process.env.AGENTHUB_STATE_DIR ? path.resolve(process.env.AGENTHUB_STATE_DIR) : path.join(workspaceRoot, ".agenthub");
const statePath = path.join(dataDir, "state.json");

const now = () => new Date().toISOString();

function baseAgents() {
  return [
    {
      id: "pm",
      name: "产品 Agent",
      role: "需求澄清",
      initials: "PM",
      color: "#2f67d8",
      tools: ["thread.read", "task.write"],
    },
    {
      id: "arch",
      name: "架构 Agent",
      role: "任务拆解",
      initials: "AR",
      color: "#6e63d9",
      tools: ["task.graph", "artifact.plan"],
    },
    {
      id: "fe",
      name: "前端 Agent",
      role: "界面实现",
      initials: "FE",
      color: "#17a7c9",
      tools: ["workspace.read", "workspace.write"],
    },
    {
      id: "qa",
      name: "测试 Agent",
      role: "验收用例",
      initials: "QA",
      color: "#22b985",
      tools: ["executor.test", "review.write"],
    },
    {
      id: "ops",
      name: "部署 Agent",
      role: "发布预览",
      initials: "OP",
      color: "#d98c24",
      tools: ["deploy.preview", "executor.build"],
    },
    {
      id: "code",
      name: "代码 Agent",
      role: "代码变更",
      initials: "CD",
      color: "#17233f",
      tools: ["git.diff", "workspace.patch"],
    },
  ];
}

function defaultState() {
  return {
    version: 1,
    agents: baseAgents(),
    threads: [
      {
        id: "group",
        title: "群聊协作",
        mode: "group",
        messages: [
          message({
            agentId: "pm",
            text: "我把 AgentHub 的 MVP 固定为 IM 协作入口、任务图、代码 Diff、预览和部署五个闭环。",
            chips: ["MVP", "产品范围"],
          }),
          message({
            agentId: "arch",
            text: "后端先提供本地 API，所有 Agent 产出都落到 Thread、TaskGraph、Artifact 与 Deployment 四类对象里。",
            chips: ["TaskGraph", "Artifact"],
          }),
          message({
            agentId: "code",
            text: "Git Diff 接真实仓库状态，执行器先开放白名单命令，避免任意命令执行带来的风险。",
            chips: ["Git Diff", "Executor"],
          }),
        ],
      },
      {
        id: "single",
        title: "单聊调试",
        mode: "single",
        messages: [
          message({
            agentId: "qa",
            text: "单聊模式适合让某个 Agent 深挖问题，比如只让测试 Agent 补充验收路径。",
            chips: ["验收", "单聊"],
          }),
        ],
      },
    ],
    taskGraph: {
      id: "mvp-graph",
      updatedAt: now(),
      nodes: [
        {
          id: "domain-model",
          title: "定义 Agent 协作域模型",
          owner: "架构 Agent",
          detail: "Workspace、Thread、Agent、Task、Artifact、Deployment。",
          status: "done",
          dependsOn: [],
          acceptanceCommand: "git:status",
        },
        {
          id: "local-api",
          title: "实现本地会话 API",
          owner: "代码 Agent",
          detail: "提供 bootstrap、threads、messages、task-graph 等接口，并写入本地状态文件。",
          status: "done",
          dependsOn: ["domain-model"],
          acceptanceCommand: "typecheck",
        },
        {
          id: "git-diff",
          title: "接入真实 Git Diff",
          owner: "代码 Agent",
          detail: "读取当前仓库工作区变更摘要，展示文件数和增删行。",
          status: "todo",
          dependsOn: ["local-api"],
          acceptanceCommand: "git:diff",
        },
        {
          id: "executor",
          title: "接入本地执行器",
          owner: "部署 Agent",
          detail: "通过白名单命令运行 typecheck、build、smoke、git diff 等操作，并把结果回写到会话。",
          status: "todo",
          dependsOn: ["local-api"],
          acceptanceCommand: "smoke",
        },
        {
          id: "workspace-untracked-audit",
          title: "归因并处理未跟踪工作区内容",
          owner: "代码 Agent",
          detail: "读取 git status 的未跟踪项，区分当前项目文件、外部运行产物和应忽略目录。",
          status: "todo",
          dependsOn: ["git-diff"],
          acceptanceCommand: "git:status",
        },
      ],
    },
    executorRuns: [],
    artifacts: [
      {
        id: "artifact-readme",
        kind: "document",
        title: "AgentHub MVP 项目说明",
        summary: "记录 AgentHub 的产品目标、MVP 范围、核心数据模型和本地运行方式。",
        source: "系统初始化",
        status: "ready",
        ref: "README.md",
        createdAt: now(),
      },
    ],
    deployment: {
      id: "preview",
      status: "idle",
      logs: ["preview channel idle", "waiting for build"],
      updatedAt: now(),
    },
  };
}

function loadState() {
  const fallback = defaultState();
  if (!existsSync(statePath)) return fallback;

  try {
    const loaded = JSON.parse(readFileSync(statePath, "utf8"));
    return normalizeState(loaded, fallback);
  } catch (error) {
    console.warn(`Unable to read ${statePath}: ${error.message}`);
    return fallback;
  }
}

function normalizeState(loaded, fallback) {
  return {
    version: 1,
    agents: Array.isArray(loaded.agents) && loaded.agents.length ? loaded.agents : fallback.agents,
    threads: Array.isArray(loaded.threads) && loaded.threads.length ? loaded.threads : fallback.threads,
    taskGraph: loaded.taskGraph?.nodes ? normalizeTaskGraph(loaded.taskGraph) : fallback.taskGraph,
    executorRuns: Array.isArray(loaded.executorRuns) ? loaded.executorRuns : fallback.executorRuns,
    artifacts: Array.isArray(loaded.artifacts) ? loaded.artifacts : fallback.artifacts,
    deployment: loaded.deployment || fallback.deployment,
  };
}

function normalizeTaskGraph(graph) {
  const nodes = graph.nodes.map((node) => ({
    source: "manual",
    updatedAt: graph.updatedAt || now(),
    ...node,
    acceptanceCommand: defaultAcceptanceCommand(node.id) || normalizeCommand(node.acceptanceCommand) || inferAcceptanceCommand(node),
  }));
  ensureAuditTask(nodes, graph.updatedAt || now());

  return {
    ...graph,
    nodes,
  };
}

export const state = loadState();
export const agents = state.agents;
export const threads = state.threads;
export const taskGraph = state.taskGraph;
export const executorRuns = state.executorRuns;
export const artifacts = state.artifacts;
export const deployment = state.deployment;

export function persistState() {
  mkdirSync(dataDir, { recursive: true });
  const tempPath = `${statePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tempPath, statePath);
}

persistState();

export function message({ agentId, text, chips = [], user = false, toolSuggestions = [] }) {
  return {
    id: randomUUID(),
    agentId,
    user: user || undefined,
    text,
    chips,
    toolSuggestions,
    createdAt: now(),
  };
}

export function createThread(title) {
  const count = threads.length + 1;
  const thread = {
    id: `thread-${Date.now()}`,
    title: title || `会话 ${count}`,
    mode: "group",
    messages: [
      message({
        agentId: "pm",
        text: "新会话已创建。你可以输入需求，我会协调 Agent 拆任务、看 Diff、跑预览。",
        chips: ["新会话"],
      }),
    ],
  };
  threads.push(thread);
  persistState();
  return thread;
}

export function addUserMessage(threadId, text) {
  const thread = findThread(threadId);
  thread.messages.push(message({ text, chips: [], user: true }));
  persistState();
  return thread;
}

export function addAgentReply(thread, mode, agentId, text, reply) {
  const targetAgent = reply?.agentId || (mode === "single" ? agentId : "arch");
  const clipped = text.length > 32 ? `${text.slice(0, 32)}...` : text;
  thread.messages.push(
    message({
      agentId: targetAgent,
      text: reply?.text || `收到。我会围绕“${clipped}”推进，并把结果同步到任务图、Diff 和执行器状态。`,
      chips: reply?.chips || (mode === "single" ? ["单聊跟进"] : ["群聊同步", "任务更新"]),
      toolSuggestions: reply?.toolSuggestions || [],
    }),
  );
  touchTask("local-api", "done");
  applyTaskMutations(reply?.taskMutations || [], { source: "agent", agentId: targetAgent });
  persistState();
  return thread;
}

export function addSystemAgentMessage({ agentId = "arch", text, chips = [], threadId = "group", toolSuggestions = [] }) {
  const thread = findThread(threadId);
  thread.messages.push(message({ agentId, text, chips, toolSuggestions }));
  persistState();
  return thread;
}

export function findThread(threadId) {
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) {
    const error = new Error("Thread not found");
    error.statusCode = 404;
    throw error;
  }
  return thread;
}

export function generateTask({ mode, agentId }) {
  const owner = mode === "single" ? agents.find((agent) => agent.id === agentId)?.name : "协作小队";
  taskGraph.nodes.push({
    id: `task-${Date.now()}`,
    title: "补充真实执行器协议",
    owner: owner || "协作小队",
    detail: "统一模型调用、仓库操作、命令执行、预览构建与部署回调。",
    status: "todo",
    dependsOn: ["executor"],
    acceptanceCommand: "typecheck",
    source: "manual",
    updatedAt: now(),
  });
  taskGraph.updatedAt = now();
  persistState();
  return taskGraph;
}

export function toggleTask(taskId) {
  const task = taskGraph.nodes.find((node) => node.id === taskId);
  if (!task) {
    const error = new Error("Task not found");
    error.statusCode = 404;
    throw error;
  }
  task.status = task.status === "done" ? "running" : "done";
  taskGraph.updatedAt = now();
  persistState();
  return taskGraph;
}

export function touchTask(taskId, status) {
  const task = taskGraph.nodes.find((node) => node.id === taskId);
  if (!task) return undefined;
  task.status = status;
  task.updatedAt = now();
  taskGraph.updatedAt = now();
  return task;
}

export function findTask(taskId) {
  return taskGraph.nodes.find((node) => node.id === taskId);
}

export function applyTaskMutations(mutations = [], context = {}) {
  const applied = [];

  for (const mutation of mutations) {
    if (mutation.type === "add") {
      const task = addTaskFromMutation(mutation, context);
      if (task) applied.push({ type: "add", id: task.id });
      continue;
    }

    if (mutation.type === "update") {
      const task = updateTaskFromMutation(mutation, context);
      if (task) applied.push({ type: "update", id: task.id });
    }
  }

  if (applied.length) {
    taskGraph.updatedAt = now();
    persistState();
  }

  return applied;
}

export function updateDeployment(next) {
  Object.assign(deployment, next, { updatedAt: now() });
  persistState();
  return deployment;
}

export function addArtifact(next) {
  const artifact = {
    id: next.id || randomUUID(),
    kind: normalizeArtifactKind(next.kind),
    title: normalizeText(next.title, 96) || "未命名产物",
    summary: normalizeText(next.summary, 280),
    source: normalizeText(next.source, 48) || "AgentHub",
    status: normalizeArtifactStatus(next.status) || "ready",
    ref: normalizeText(next.ref, 160),
    metadata: next.metadata && typeof next.metadata === "object" ? next.metadata : undefined,
    createdAt: next.createdAt || now(),
  };

  artifacts.unshift(artifact);
  if (artifacts.length > 20) artifacts.splice(20);
  persistState();
  return artifact;
}

export function addExecutorRun(run) {
  executorRuns.unshift(run);
  if (executorRuns.length > 10) executorRuns.splice(10);
  persistState();
  return run;
}

export function resetRuntimeState() {
  const next = defaultState();

  agents.splice(0, agents.length, ...next.agents);
  threads.splice(0, threads.length, ...next.threads);
  taskGraph.id = next.taskGraph.id;
  taskGraph.updatedAt = next.taskGraph.updatedAt;
  taskGraph.nodes.splice(0, taskGraph.nodes.length, ...next.taskGraph.nodes);
  executorRuns.splice(0, executorRuns.length);
  artifacts.splice(0, artifacts.length, ...next.artifacts);
  Object.assign(deployment, next.deployment);

  state.version = next.version;
  persistState();
  return state;
}

export function completeExecutorRun(runId, patch, options = {}) {
  const run = executorRuns.find((item) => item.id === runId);
  if (!run) return undefined;

  Object.assign(run, patch, { finishedAt: patch.finishedAt || now() });
  if (run.command.startsWith("git:")) {
    touchTask("git-diff", run.status === "success" ? "done" : "blocked");
  } else {
    touchTask("executor", run.status === "success" ? "done" : "blocked");
  }

  if (options.taskId) {
    touchTask(options.taskId, taskStatusFromRun(run, options.taskId));
  }

  addArtifact(executorArtifact(run, options));

  addSystemAgentMessage({
    agentId: run.command.startsWith("git:") ? "code" : "qa",
    threadId: options.threadId || "group",
    text:
      run.status === "success"
        ? `执行器已完成 ${run.command}，结果已写入本地运行记录。`
        : `执行器运行 ${run.command} 失败，请查看右侧部署面板的输出。`,
    chips: ["Executor", run.status],
  });
  persistState();
  return run;
}

function addTaskFromMutation(mutation, context) {
  const title = normalizeText(mutation.title, 80);
  if (!title) return undefined;

  const id = uniqueTaskId(mutation.id || title);
  const owner = normalizeText(mutation.owner, 40) || agentName(context.agentId) || "协作小队";
  const detail = normalizeText(mutation.detail, 220) || "由 Agent 根据会话上下文补充。";
  const dependsOn = normalizeDependsOn(mutation.dependsOn);

  const task = {
    id,
    title,
    owner,
    detail,
    status: normalizeTaskStatus(mutation.status) || "todo",
    dependsOn,
    acceptanceCommand: normalizeCommand(mutation.acceptanceCommand) || inferAcceptanceCommand({ id, title, owner, detail }),
    source: context.source || "agent",
    updatedAt: now(),
  };

  taskGraph.nodes.push(task);
  return task;
}

function updateTaskFromMutation(mutation, context) {
  const id = normalizeTaskId(mutation.id);
  if (!id) return undefined;

  const task = taskGraph.nodes.find((node) => node.id === id);
  if (!task) return undefined;

  const status = normalizeTaskStatus(mutation.status);
  if (status) task.status = status;

  const title = normalizeText(mutation.title, 80);
  if (title) task.title = title;

  const detail = normalizeText(mutation.detail, 220);
  if (detail) task.detail = detail;

  const owner = normalizeText(mutation.owner, 40);
  if (owner) task.owner = owner;

  if (Array.isArray(mutation.dependsOn)) {
    task.dependsOn = normalizeDependsOn(mutation.dependsOn);
  }

  const acceptanceCommand = normalizeCommand(mutation.acceptanceCommand);
  if (acceptanceCommand) task.acceptanceCommand = acceptanceCommand;

  task.source = context.source || task.source || "agent";
  task.updatedAt = now();
  return task;
}

function uniqueTaskId(value) {
  const base = normalizeTaskId(value) || `task-${Date.now()}`;
  let id = base;
  let index = 2;
  while (taskGraph.nodes.some((node) => node.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function normalizeTaskId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeTaskStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return ["done", "running", "todo", "blocked"].includes(status) ? status : "";
}

function normalizeArtifactKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return ["diff", "test", "build", "preview", "document", "log"].includes(kind) ? kind : "log";
}

function normalizeArtifactStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return ["ready", "running", "failed"].includes(status) ? status : "ready";
}

function normalizeText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeDependsOn(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeTaskId).filter(Boolean).slice(0, 6);
}

function normalizeCommand(value) {
  const command = String(value || "").trim().toLowerCase();
  return ["git:status", "git:diff", "typecheck", "build", "smoke"].includes(command) ? command : "";
}

function defaultAcceptanceCommand(taskId) {
  return {
    "domain-model": "git:status",
    "local-api": "typecheck",
    "git-diff": "git:diff",
    executor: "smoke",
    "workspace-untracked-audit": "git:status",
  }[taskId] || "";
}

function ensureAuditTask(nodes, updatedAt) {
  const existing = nodes.find((node) => node.id === "workspace-untracked-audit");
  if (existing) {
    existing.acceptanceCommand = "git:status";
    existing.dependsOn = existing.dependsOn?.length ? existing.dependsOn : ["git-diff"];
    return;
  }

  nodes.push({
    id: "workspace-untracked-audit",
    title: "归因并处理未跟踪工作区内容",
    owner: "代码 Agent",
    detail: "读取 git status 的未跟踪项，区分当前项目文件、外部运行产物和应忽略目录。",
    status: "todo",
    dependsOn: ["git-diff"],
    source: "agent",
    updatedAt,
    acceptanceCommand: "git:status",
  });
}

function taskStatusFromRun(run, taskId) {
  if (run.status !== "success") return "blocked";

  if (taskId === "workspace-untracked-audit") {
    const hasUntracked = String(run.output || "")
      .split(/\r?\n/)
      .some((line) => line.trimStart().startsWith("??"));
    return hasUntracked ? "blocked" : "done";
  }

  return "done";
}

function inferAcceptanceCommand(task) {
  const text = `${task.id || ""} ${task.title || ""} ${task.owner || ""} ${task.detail || ""}`.toLowerCase();
  if (/(git|diff|代码变更|仓库)/i.test(text)) return "git:diff";
  if (/(build|构建|部署|预览|发布)/i.test(text)) return "build";
  if (/(smoke|闭环|执行器|api|接口)/i.test(text)) return "smoke";
  if (/(验收|测试|质量|typecheck|类型|前端|实现)/i.test(text)) return "typecheck";
  return "git:status";
}

function agentName(agentId) {
  return agents.find((agent) => agent.id === agentId)?.name;
}

function executorArtifact(run, options) {
  const kind = run.command === "build" ? "build" : run.command === "typecheck" || run.command === "smoke" ? "test" : run.command === "git:diff" ? "diff" : "log";
  const status = run.status === "success" ? "ready" : "failed";
  const output = normalizeText(run.output || "(no output)", 180);
  return {
    kind,
    title: `${run.command} 执行记录`,
    summary: `${run.command} ${run.status === "success" ? "执行成功" : "执行失败"}。${output}`,
    source: options.taskId ? `任务 ${options.taskId}` : "本地执行器",
    status,
    ref: run.id,
    metadata: {
      command: run.command,
      taskId: options.taskId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
  };
}
