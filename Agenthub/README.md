# AgentHub 多 Agent 协作平台

AgentHub 的目标是做一个 IM 聊天式的多 Agent 协作平台：用户像拉群沟通一样提出需求，系统把上下文分发给不同 Agent，自动完成任务拆解、代码变更、网页预览和一键部署。

## MVP 范围

1. 协作入口：支持单聊、群聊、Agent 在线状态、会话切换、消息流。
2. 任务拆解：从聊天指令生成任务卡片，记录负责人、状态和进度。
3. 代码 Diff：把 Agent 的实现结果汇总为可审查的变更摘要。
4. 网页预览：展示最新交付物的预览状态，后续接真实构建产物。
5. 一键部署：模拟部署流水线，沉淀构建、检查、发布和分享链接状态。

## 产品阶段

### Phase 1：静态可交互原型

- 当前已实现：纯前端工作台，直接打开 `index.html` 即可体验。
- 目的：快速验证信息架构、核心操作路径和视觉方向。

### Phase 2：本地执行器

- 增加 Node/TypeScript 服务。
- 定义 `AgentRuntime`、`TaskGraph`、`ArtifactStore`、`DeploymentProvider`。
- 接入本地文件读写、Git diff、测试命令和预览服务。

### Phase 3：真实多 Agent 编排

- 接入模型 API 与工具调用。
- 支持 Agent 角色配置、上下文窗口管理、任务重试、人工确认。
- 对接 GitHub/GitLab PR、CI、Vercel/Netlify/自托管部署。

## 建议技术路线

- 前端：React + TypeScript + Vite，状态管理先用 Zustand 或 React Context。
- 后端：Node.js + Fastify，任务队列可先内存实现，后续换 SQLite/Postgres。
- 实时通信：WebSocket 或 Server-Sent Events。
- 代码执行：隔离 workspace，所有写入走审计日志和 Diff 面板。
- 部署：先接静态预览，再扩展容器化应用部署。

## 核心数据模型

```text
Workspace
  ├─ Thread：单聊或群聊会话
  ├─ Agent：角色、能力、工具权限、上下文策略
  ├─ Task：拆解后的任务节点、依赖、状态、负责人
  ├─ Artifact：代码、文档、图片、测试报告、预览地址
  └─ Deployment：构建、检查、发布、回滚记录
```

当前本地状态写入 `.agenthub/state.json`，包括会话、消息、任务图、执行器运行记录和部署状态。该目录默认不进入 Git。

## 下一步开发清单

1. 把当前静态页面迁移为 Vite + React + TypeScript。
2. 增加本地 API：会话、任务、Agent 配置、Diff 和部署状态。
3. 持久化本地状态：会话、任务图、执行器和部署状态写入 `.agenthub/state.json`。
4. 接入真实模型调用，先支持一个 orchestrator 调度多个角色提示词。
5. 接入 Git 工作区，所有 Agent 产出先进入 Diff 面板再由用户确认。
6. 接入预览服务，支持“生成变更 -> 启动预览 -> 分享链接”的闭环。
7. 增加权限边界：文件写入、命令执行、部署发布都需要可追踪确认。

## 本地运行

当前版本已经迁移为 Vite + React + TypeScript，并包含一个 Node 本地 API。

```bash
npm install
npm run dev
```

默认地址：

- Web 工作台：http://127.0.0.1:5173
- 本地 API：http://127.0.0.1:8787/api/bootstrap

说明：当前 Windows 环境下 Vite dev 的依赖预优化会被目录权限拦截，所以 `npm run dev` 会先构建 React/TypeScript，再用本地静态服务器托管 `dist`，保证页面稳定打开。

常用校验：

```bash
npm run typecheck
npm run build
```

如果 PowerShell 拦截 `npm`，在 Windows 上可使用 `npm.cmd`：

```bash
npm.cmd install
npm.cmd run dev
```

## LLM Orchestrator

服务端已接入可配置 LLM Provider。你可以使用 OpenAI，也可以使用 Aigo，只要 Aigo 提供 OpenAI 兼容接口。

使用 Aigo：

```bash
AGENTHUB_LLM_PROVIDER=aigo
AIGO_API_KEY=你的 Aigo key
AIGO_BASE_URL=https://你的-aigo-endpoint/v1
AIGO_MODEL=gpt-5.5
AIGO_API_STYLE=chat
AGENTHUB_REASONING_EFFORT=low
```

如果 Aigo 支持 `/v1/responses`，把 `AIGO_API_STYLE` 改为 `responses`。如果 Aigo 支持 `/v1/chat/completions`，保持 `chat`。

使用 OpenAI：

```bash
AGENTHUB_LLM_PROVIDER=openai
OPENAI_API_KEY=你的 OpenAI key
AGENTHUB_OPENAI_MODEL=gpt-5.5
AGENTHUB_OPENAI_FALLBACK_MODEL=gpt-5.4-mini
```

没有配置有效 key 或 base URL 时，系统会使用本地降级回复，并在聊天里明确标记 `Local Fallback`。配置 provider 后，发送消息会进入 LLM Orchestrator：它会读取最近会话、任务图、Git Diff 摘要，并选择合适的 Agent 回复。
