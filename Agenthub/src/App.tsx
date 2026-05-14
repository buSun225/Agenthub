import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type {
  Agent,
  AgentId,
  Artifact,
  BootstrapPayload,
  CollaborationMode,
  Deployment,
  ExecutorRun,
  GitDiffSummary,
  OrchestratorStatus,
  TaskGraph,
  Thread,
} from "./types";

type InspectorPanel = "tasks" | "artifacts" | "diff" | "preview" | "deploy";

const navItems = [
  { id: "workspace", label: "协作工作台", icon: "chat" },
  { id: "tasks", label: "任务流水线", icon: "list" },
  { id: "code", label: "代码变更", icon: "code" },
  { id: "deploy", label: "一键部署", icon: "upload" },
] as const;

function App() {
  const [payload, setPayload] = useState<BootstrapPayload | null>(null);
  const [activeThreadId, setActiveThreadId] = useState("group");
  const [activeAgentId, setActiveAgentId] = useState<AgentId>("pm");
  const [mode, setMode] = useState<CollaborationMode>("group");
  const [panel, setPanel] = useState<InspectorPanel>("tasks");
  const [message, setMessage] = useState("");
  const [command, setCommand] = useState("git:status");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  const activeThread = useMemo(() => {
    return payload?.threads.find((thread) => thread.id === activeThreadId) || payload?.threads[0];
  }, [payload?.threads, activeThreadId]);

  const activeAgent = useMemo(() => {
    return payload?.agents.find((agent) => agent.id === activeAgentId) || payload?.agents[0];
  }, [payload?.agents, activeAgentId]);

  const progress = useMemo(() => {
    if (!payload?.taskGraph.nodes.length) return 0;
    const done = payload.taskGraph.nodes.filter((node) => node.status === "done").length;
    return Math.round((done / payload.taskGraph.nodes.length) * 100);
  }, [payload?.taskGraph]);

  async function refresh() {
    try {
      setError(null);
      const next = await api.bootstrap();
      setPayload(next);
      if (!next.threads.some((thread) => thread.id === activeThreadId)) {
        setActiveThreadId(next.threads[0]?.id || "group");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateThread() {
    await runAction("create-thread", async () => {
      const thread = await api.createThread();
      setPayload((current) => (current ? { ...current, threads: [...current.threads, thread] } : current));
      setActiveThreadId(thread.id);
    });
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || !activeThread) return;
    setMessage("");
    await runAction("send-message", async () => {
      const thread = await api.sendMessage(activeThread.id, text, mode, activeAgentId);
      replaceThread(thread);
      await refresh();
    });
  }

  async function handleGenerateTask() {
    if (!activeThread) return;
    await runAction("generate-task", async () => {
      const taskGraph = await api.generateTask(activeThread.id, mode, activeAgentId);
      updateTaskGraph(taskGraph);
      setPanel("tasks");
    });
  }

  async function handleToggleTask(taskId: string) {
    await runAction(`toggle-${taskId}`, async () => {
      const taskGraph = await api.toggleTask(taskId);
      updateTaskGraph(taskGraph);
    });
  }

  async function handleRefreshDiff() {
    await runAction("refresh-diff", async () => {
      const [diff, status] = await Promise.all([api.getDiff(), api.getStatus()]);
      diff.status = status;
      updateDiff(diff);
      setPanel("diff");
    });
  }

  async function handleExecutorRun() {
    if (!activeThread) return;
    await runAction("executor", async () => {
      await api.runExecutor(command, activeThread.id);
      await refresh();
      setPanel("deploy");
    });
  }

  async function handleRunSuggestedTool(commandName: string) {
    if (!activeThread) return;
    setCommand(commandName);
    await runAction(`tool-${commandName}`, async () => {
      await api.runExecutor(commandName, activeThread.id);
      await refresh();
      setPanel("deploy");
    });
  }

  async function handleRunTaskAcceptance(taskId: string, commandName: string) {
    if (!activeThread) return;
    setCommand(commandName);
    await runAction(`task-acceptance-${taskId}`, async () => {
      await api.runExecutor(commandName, activeThread.id, taskId);
      await refresh();
      setPanel("deploy");
    });
  }

  async function handleDeploy() {
    await runAction("deploy", async () => {
      const deployment = await api.deploy();
      updateDeployment(deployment);
      setPanel("deploy");
      window.setTimeout(() => void refresh(), 900);
    });
  }

  async function runAction(name: string, action: () => Promise<void>) {
    try {
      setBusy(name);
      setError(null);
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  function replaceThread(thread: Thread) {
    setPayload((current) =>
      current
        ? {
            ...current,
            threads: current.threads.map((item) => (item.id === thread.id ? thread : item)),
          }
        : current,
    );
  }

  function updateTaskGraph(taskGraph: TaskGraph) {
    setPayload((current) => (current ? { ...current, taskGraph } : current));
  }

  function updateDiff(diff: GitDiffSummary) {
    setPayload((current) => (current ? { ...current, diff } : current));
  }

  function updateDeployment(deployment: Deployment) {
    setPayload((current) => (current ? { ...current, deployment } : current));
  }

  if (loading) {
    return <div className="loading-screen">AgentHub 正在连接本地 API...</div>;
  }

  if (!payload) {
    return (
      <div className="loading-screen">
        <strong>本地 API 未连接</strong>
        <span>{error || "请先启动 npm run dev"}</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="项目导航">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            AH
          </div>
          <div>
            <strong>AgentHub</strong>
            <span>AIGC 协作工作台</span>
          </div>
        </div>

        <div className="project-switcher">
          <label htmlFor="projectSelect">当前项目</label>
          <select id="projectSelect">
            <option>IM 聊天式协作平台</option>
            <option>企业知识库 Copilot</option>
            <option>代码审查流水线</option>
          </select>
        </div>

        <nav className="nav-stack" aria-label="主功能">
          {navItems.map((item, index) => (
            <button
              className={`nav-item ${index === 0 ? "is-active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === "tasks") setPanel("tasks");
                if (item.id === "code") setPanel("diff");
                if (item.id === "deploy") setPanel("deploy");
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        <section className="panel compact-panel">
          <div className="section-title">
            <span>在线 Agent</span>
            <strong>{payload.agents.length}</strong>
          </div>
          <div className="agent-list">
            {payload.agents.map((agent) => (
              <button
                className={`agent-card ${agent.id === activeAgentId ? "is-selected" : ""}`}
                key={agent.id}
                type="button"
                onClick={() => setActiveAgentId(agent.id)}
              >
                <span className="avatar" style={{ background: agent.color }}>
                  {agent.initials}
                </span>
                <span>
                  <strong>{agent.name}</strong>
                  <span>{agent.role}</span>
                </span>
                <span className="presence" aria-label="在线" />
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">多 Agent 协作平台</p>
            <h1>IM 式研发任务工作台</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" title="新建会话" aria-label="新建会话" onClick={handleCreateThread}>
              <Icon name="plus" />
            </button>
            <button className="icon-button" type="button" title="同步工作区" aria-label="同步工作区" onClick={() => void refresh()}>
              <Icon name="sync" />
            </button>
            <button className="primary-button" type="button" onClick={handleDeploy}>
              <Icon name="upload" />
              部署预览
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <StatusStrip
          deployment={payload.deployment}
          diff={payload.diff}
          mode={mode}
          orchestrator={payload.orchestrator}
          progress={progress}
          agents={payload.agents}
        />

        <div className="work-grid">
          <section className="thread-panel" aria-label="聊天协作区">
            <div className="thread-toolbar">
              <div className="thread-tabs" role="tablist" aria-label="会话列表">
                {payload.threads.map((thread) => (
                  <button
                    className={thread.id === activeThread?.id ? "is-active" : ""}
                    key={thread.id}
                    type="button"
                    onClick={() => setActiveThreadId(thread.id)}
                  >
                    {thread.title}
                  </button>
                ))}
              </div>
              <div className="segmented-control" aria-label="协作模式">
                <button className={mode === "group" ? "is-selected" : ""} type="button" onClick={() => setMode("group")}>
                  群聊
                </button>
                <button className={mode === "single" ? "is-selected" : ""} type="button" onClick={() => setMode("single")}>
                  单聊
                </button>
              </div>
            </div>

            <ChatFeed agents={payload.agents} onRunTool={handleRunSuggestedTool} thread={activeThread} />

            <form className="composer" onSubmit={handleSend}>
              <div className="composer-tools">
                <button className="tool-button" type="button" title="添加附件" aria-label="添加附件">
                  <Icon name="paperclip" />
                </button>
                <button className="tool-button" type="button" title="拆解任务" aria-label="拆解任务" onClick={handleGenerateTask}>
                  <Icon name="graph" />
                </button>
                <button className="tool-button" type="button" title="刷新 Diff" aria-label="刷新 Diff" onClick={handleRefreshDiff}>
                  <Icon name="diff" />
                </button>
              </div>
              <label className="sr-only" htmlFor="messageInput">
                发送给 AgentHub
              </label>
              <textarea
                id="messageInput"
                rows={1}
                placeholder={mode === "group" ? "输入需求、问题或 @Agent 分派任务" : `单聊 ${activeAgent?.name || "Agent"}`}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <button className="send-button" type="submit" aria-label="发送" disabled={busy === "send-message"}>
                <Icon name="send" />
              </button>
            </form>
          </section>

          <Inspector
            command={command}
            artifacts={payload.artifacts}
            deployment={payload.deployment}
            diff={payload.diff}
            executorRuns={payload.executorRuns}
            onCommandChange={setCommand}
            onDeploy={handleDeploy}
            onGenerateTask={handleGenerateTask}
            onRefreshDiff={handleRefreshDiff}
            onRunExecutor={handleExecutorRun}
            onRunTaskAcceptance={handleRunTaskAcceptance}
            onToggleTask={handleToggleTask}
            panel={panel}
            setPanel={setPanel}
            taskGraph={payload.taskGraph}
          />
        </div>
      </main>
    </div>
  );
}

function StatusStrip({
  agents,
  deployment,
  diff,
  mode,
  orchestrator,
  progress,
}: {
  agents: Agent[];
  deployment: Deployment;
  diff: GitDiffSummary;
  mode: CollaborationMode;
  orchestrator: OrchestratorStatus;
  progress: number;
}) {
  return (
    <section className="status-strip" aria-label="项目状态">
      <article>
        <span>任务进度</span>
        <strong>{progress}%</strong>
        <div className="meter">
          <span style={{ width: `${progress}%` }} />
        </div>
      </article>
      <article>
        <span>最新 Diff</span>
        <strong>{diff.filesChanged} files</strong>
        <small>
          +{diff.insertions} / -{diff.deletions}
        </small>
      </article>
      <article>
        <span>预览环境</span>
        <strong>{deployment.status === "live" ? "Live" : deployment.status === "building" ? "Building" : "Ready"}</strong>
        <small>{deployment.url || "agenthub-preview.local"}</small>
      </article>
      <article>
        <span>智能引擎</span>
        <strong>{orchestrator.configured ? "LLM" : "Fallback"}</strong>
        <small>
          {mode === "group" ? "群聊" : "单聊"} · {orchestrator.provider}/{orchestrator.apiStyle || "chat"} ·{" "}
          {orchestrator.model} · {agents.length} agents
        </small>
      </article>
    </section>
  );
}

function ChatFeed({
  agents,
  onRunTool,
  thread,
}: {
  agents: Agent[];
  onRunTool: (command: string) => void;
  thread?: Thread;
}) {
  if (!thread) {
    return <div className="chat-feed empty-state">还没有会话。</div>;
  }

  return (
    <div className="chat-feed" aria-live="polite">
      {thread.messages.map((message) => {
        const agent = agents.find((item) => item.id === message.agentId);
        const isUser = message.user;
        return (
          <article className={`message ${isUser ? "is-user" : ""}`} key={message.id}>
            <span className="avatar" style={{ background: isUser ? "#17233f" : agent?.color }}>
              {isUser ? "我" : agent?.initials || "AI"}
            </span>
            <div className="message-bubble">
              <div className="message-head">
                <strong className="message-name">{isUser ? "你" : agent?.name || "Agent"}</strong>
                <span className="message-meta">{isUser ? "用户输入" : agent?.role}</span>
              </div>
              <p className="message-text">{message.text}</p>
              {message.chips.length ? (
                <div className="message-actions">
                  {message.chips.map((chip) => (
                    <span className="chip" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
              {message.toolSuggestions?.length ? (
                <div className="tool-suggestions">
                  {message.toolSuggestions.map((suggestion) => (
                    <button key={suggestion.id} type="button" onClick={() => onRunTool(suggestion.command)}>
                      <Icon name="play" />
                      <span>
                        <strong>{suggestion.title}</strong>
                        <small>{suggestion.command}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Inspector({
  command,
  artifacts,
  deployment,
  diff,
  executorRuns,
  onCommandChange,
  onDeploy,
  onGenerateTask,
  onRefreshDiff,
  onRunExecutor,
  onRunTaskAcceptance,
  onToggleTask,
  panel,
  setPanel,
  taskGraph,
}: {
  command: string;
  artifacts: Artifact[];
  deployment: Deployment;
  diff: GitDiffSummary;
  executorRuns: ExecutorRun[];
  onCommandChange: (command: string) => void;
  onDeploy: () => void;
  onGenerateTask: () => void;
  onRefreshDiff: () => void;
  onRunExecutor: () => void;
  onRunTaskAcceptance: (taskId: string, command: string) => void;
  onToggleTask: (taskId: string) => void;
  panel: InspectorPanel;
  setPanel: (panel: InspectorPanel) => void;
  taskGraph: TaskGraph;
}) {
  return (
    <aside className="inspector" aria-label="任务与预览">
      <div className="inspector-tabs" role="tablist">
        {(["tasks", "artifacts", "diff", "preview", "deploy"] as InspectorPanel[]).map((item) => (
          <button className={panel === item ? "is-active" : ""} key={item} type="button" onClick={() => setPanel(item)}>
            {panelLabel(item)}
          </button>
        ))}
      </div>

      <section className={`inspector-panel ${panel === "tasks" ? "is-active" : ""}`}>
        <div className="section-title">
          <span>任务拆解</span>
          <button className="mini-button" type="button" onClick={onGenerateTask}>
            新增
          </button>
        </div>
        <div className="task-list">
          {taskGraph.nodes.map((task) => {
            const acceptanceCommand = task.acceptanceCommand || "git:status";
            return (
              <article className={`task-card ${task.status === "done" ? "is-done" : ""}`} key={task.id}>
                <span className="task-check">{task.status === "done" ? "✓" : ""}</span>
                <span>
                  <strong>{task.title}</strong>
                  <p>{task.detail}</p>
                  <small>{task.owner}</small>
                  <span className="task-meta">
                    {task.source === "agent" ? "Agent 同步" : "手动任务"}
                    {task.dependsOn.length ? ` · 依赖 ${task.dependsOn.join(", ")}` : ""}
                    {` · 验收 ${acceptanceCommand}`}
                  </span>
                </span>
                <span className="task-actions">
                  <span className={`task-status status-${task.status}`}>{statusLabel(task.status)}</span>
                  <button className="mini-button" type="button" onClick={() => onRunTaskAcceptance(task.id, acceptanceCommand)}>
                    验收
                  </button>
                  <button className="mini-button ghost" type="button" onClick={() => onToggleTask(task.id)}>
                    切换
                  </button>
                </span>
              </article>
            );
          })}
        </div>
      </section>

      <section className={`inspector-panel ${panel === "artifacts" ? "is-active" : ""}`}>
        <div className="section-title">
          <span>产物时间线</span>
          <strong>{artifacts.length}</strong>
        </div>
        <div className="artifact-list">
          {artifacts.map((artifact) => (
            <article className={`artifact-card artifact-${artifact.status}`} key={artifact.id}>
              <div className="artifact-head">
                <span className={`artifact-kind kind-${artifact.kind}`}>{artifactKindLabel(artifact.kind)}</span>
                <small>{formatTime(artifact.createdAt)}</small>
              </div>
              <strong>{artifact.title}</strong>
              <p>{artifact.summary}</p>
              <div className="artifact-meta">
                <span>{artifact.source}</span>
                {artifact.ref ? <code>{artifact.ref}</code> : null}
              </div>
            </article>
          ))}
          {!artifacts.length ? <div className="empty-card">暂无产物。运行执行器或发布预览后会自动记录。</div> : null}
        </div>
      </section>

      <section className={`inspector-panel ${panel === "diff" ? "is-active" : ""}`}>
        <div className="section-title">
          <span>代码 Diff</span>
          <button className="mini-button" type="button" onClick={onRefreshDiff}>
            刷新
          </button>
        </div>
        <div className="diff-card">
          <div className="diff-file">
            <span>{diff.available ? "git diff -- Agenthub" : "Git Diff 不可用"}</span>
            <strong>
              +{diff.insertions} -{diff.deletions}
            </strong>
          </div>
          <pre>
            <code>{diff.error || diff.raw}</code>
          </pre>
        </div>
        <div className="review-summary">
          <strong>真实仓库状态</strong>
          <p>
            {diff.status?.clean
              ? "当前 git status 没有发现未提交变更。"
              : `当前共有 ${diff.status?.counts.total || 0} 个工作区状态项，其中未跟踪 ${diff.status?.counts.untracked || 0} 个。`}
          </p>
        </div>
        {diff.status?.untracked.length ? (
          <div className="status-list">
            <div className="section-title">
              <span>未跟踪项</span>
              <strong>{diff.status.counts.untracked}</strong>
            </div>
            {diff.status.untracked.slice(0, 24).map((entry) => (
              <article className={`status-entry ${entry.scope === "external" ? "is-external" : ""}`} key={`${entry.code}-${entry.path}`}>
                <span>{entry.code}</span>
                <strong>{entry.path}</strong>
                <small>{entry.scope === "external" ? "工作区外" : "当前项目"}</small>
              </article>
            ))}
            {diff.status.untracked.length > 24 ? (
              <article className="status-entry is-muted">
                <span>...</span>
                <strong>还有 {diff.status.untracked.length - 24} 个未跟踪项未显示</strong>
                <small>已折叠</small>
              </article>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={`inspector-panel ${panel === "preview" ? "is-active" : ""}`}>
        <div className="browser-shell">
          <div className="browser-bar">
            <span />
            <span />
            <span />
            <input value={deployment.url || "https://preview.agenthub.local"} aria-label="预览地址" readOnly />
          </div>
          <div className="preview-page">
            <div className="preview-sidebar" />
            <div className="preview-content">
              <div className="preview-line wide" />
              <div className="preview-line" />
              <div className="preview-cards">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
        <button className="primary-button full-width" type="button" onClick={onDeploy}>
          <Icon name="sync" />
          发布预览
        </button>
      </section>

      <section className={`inspector-panel ${panel === "deploy" ? "is-active" : ""}`}>
        <div className="deploy-card">
          <span className={`deploy-badge ${deployment.status === "live" ? "is-live" : ""}`}>{deploymentLabel(deployment.status)}</span>
          <h2>Local Executor</h2>
          <p>执行器只开放白名单命令。当前可跑 typecheck、build、git status 和 git diff。</p>
          <div className="executor-row">
            <select value={command} onChange={(event) => onCommandChange(event.target.value)}>
              <option value="git:status">git:status</option>
              <option value="git:diff">git:diff</option>
              <option value="typecheck">typecheck</option>
              <option value="build">build</option>
            </select>
            <button className="primary-button" type="button" onClick={onRunExecutor}>
              <Icon name="play" />
              运行
            </button>
          </div>
          <button className="primary-button full-width" type="button" onClick={onDeploy}>
            <Icon name="upload" />
            一键部署
          </button>
        </div>
        <div className="deploy-log">
          {deployment.logs.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <div className="run-list">
          {executorRuns.map((run) => (
            <article className="run-card" key={run.id}>
              <div>
                <strong>{run.command}</strong>
                <span className={`run-status run-${run.status}`}>{run.status}</span>
              </div>
              <pre>
                <code>{run.output}</code>
              </pre>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

function panelLabel(panel: InspectorPanel) {
  const labels: Record<InspectorPanel, string> = {
    tasks: "任务",
    artifacts: "产物",
    diff: "Diff",
    preview: "预览",
    deploy: "部署",
  };
  return labels[panel];
}

function artifactKindLabel(kind: Artifact["kind"]) {
  const labels: Record<Artifact["kind"], string> = {
    diff: "Diff",
    test: "测试",
    build: "构建",
    preview: "预览",
    document: "文档",
    log: "日志",
  };
  return labels[kind];
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    done: "完成",
    running: "进行中",
    todo: "待办",
    blocked: "阻塞",
  };
  return labels[status] || status;
}

function deploymentLabel(status: Deployment["status"]) {
  const labels: Record<Deployment["status"], string> = {
    idle: "未部署",
    building: "部署中",
    live: "已部署",
    failed: "失败",
  };
  return labels[status];
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    chat: "M4 5h16v10H7l-3 3V5Z",
    list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    code: "m8 9-4 3 4 3m8-6 4 3-4 3M14 4l-4 16",
    upload: "M12 19V5m0 0-5 5m5-5 5 5M5 19h14",
    plus: "M12 5v14M5 12h14",
    sync: "M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4m-4 4a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4",
    paperclip: "m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.8-8.8",
    graph: "M4 7h6v6H4V7Zm10-3h6v6h-6V4Zm0 10h6v6h-6v-6ZM7 13v3a2 2 0 0 0 2 2h5M10 10h4",
    diff: "M5 8h14M5 16h14M9 4v8M15 12v8",
    send: "m4 12 16-8-5 16-3-7-8-1Z",
    play: "M8 5v14l11-7-11-7Z",
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] || paths.chat} />
    </svg>
  );
}

export default App;
