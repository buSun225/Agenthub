# AgentHub 项目说明

## 目标

AgentHub 是一个 IM 聊天式多 Agent 协作平台，目标是支持单聊、群聊、任务拆解、代码 Diff、网页预览、本地执行器和一键部署。

## 技术栈

- 前端：Vite + React + TypeScript。
- 后端：Node.js 原生 HTTP API。
- 本地状态：`.agenthub/state.json`，默认不提交到 Git。
- LLM Provider：可配置 OpenAI 兼容接口，当前按全局规则默认使用 AigoCode。

## 目录结构

- `src/`：React 工作台 UI、API 客户端、类型定义。
- `server/`：本地 API、状态持久化、ArtifactStore、Git Diff、执行器、LLM Orchestrator、静态服务器。
- `scripts/dev.mjs`：同时启动 API 和静态 Web 服务。
- `dist/`：构建后的前端产物。
- 当前 Git 仓库根目录和项目根目录均为 `D:\codexxx\Agent`；Git 状态与执行器输出以该目录为基准。

## 核心流程

1. 浏览器打开 `http://127.0.0.1:5173/`。
2. 前端调用 `http://127.0.0.1:8787/api/bootstrap` 获取 Agent、会话、任务图、产物、Diff、执行器和 Orchestrator 状态。
3. 用户发送消息后，API 将消息写入 `.agenthub/state.json`。
4. Orchestrator 根据会话、任务图、Git Diff 摘要和协作模式选择 Agent 回复。
5. Orchestrator 可以在回复中生成白名单工具建议，例如 `git:status`、`git:diff`、`typecheck`、`build`、`smoke`。
6. 前端聊天气泡展示工具建议按钮，用户点击后调用本地执行器。
7. 执行器命令完成后把结果写回运行记录、任务图和当前会话消息。
8. 执行器、Diff、构建、预览和文档类结果会沉淀为 `artifacts` 产物时间线，前端检查器提供“产物”页查看来源、摘要、引用和状态。
9. Orchestrator 会读取执行器输出摘要，再由对应 Agent 追加一条结果总结和下一步建议；总结仍可生成白名单工具建议按钮。
10. Orchestrator 回复可以携带受控结构化任务标记，后端解析后新增或更新任务图；任务节点会记录 `source`，用于区分手动任务和 Agent 同步任务。
11. LLM 请求默认有超时保护，超时或失败时返回本地 fallback；当用户明确要求任务图/任务节点同步时，本地 fallback 会补充一个保守的下一步任务。
12. 任务节点支持 `acceptanceCommand`，只能绑定执行器白名单命令；前端任务卡提供“验收”按钮，执行成功/失败会自动把该任务标记为 `done`/`blocked` 并写回会话。
13. Git 状态支持结构化读取：`/api/git/status` 返回 tracked/untracked/external 统计和条目；Diff 面板会展示未跟踪项，`workspace-untracked-audit` 任务用 `git:status` 验收，只有工作区干净才算完成。
14. `npm.cmd run smoke` 会在临时端口和隔离状态目录启动 API，验证 bootstrap、任务图、产物、执行器命令白名单和会话读写接口；执行器任务默认用 `smoke` 验收。

## 运行方式

```bash
npm.cmd install
npm.cmd run dev
```

常用校验：

```bash
npm.cmd run typecheck
npm.cmd run build
npm.cmd run smoke
```

## LLM 配置约定

当前按全局规则使用：

- Provider：`aigocode`
- Base URL：`https://api.aigocode.com`
- Wire API：`responses`
- Model：`gpt-5.5`
- Reasoning effort：`xhigh`

在项目 `.env.local` 中映射为：

```bash
AGENTHUB_LLM_PROVIDER=aigo
AIGO_BASE_URL=https://api.aigocode.com
AIGO_MODEL=gpt-5.5
AIGO_API_STYLE=responses
AGENTHUB_REASONING_EFFORT=xhigh
AGENTHUB_LLM_TIMEOUT_MS=30000
```

`AIGO_API_KEY` 需要由用户填入或通过安全环境变量注入，不应提交到 Git。

## 已知风险

- 当前 Vite dev 在本机权限环境下会触发依赖预优化问题，因此 `npm run dev` 采用先 build 再托管 `dist` 的稳定模式。
- LLM Provider 必须兼容 `responses` 或 `chat/completions` 接口，否则会自动降级为本地 fallback 回复。
- 工作区归因时需要区分项目源码、`.agenthub/` 本地状态、`dist/`、`.npm-cache/` 与日志等运行产物；日志文件不应纳入 Git。
