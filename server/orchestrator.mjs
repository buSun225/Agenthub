import "./env.mjs";
import { readGitDiff } from "./git.mjs";

const DEFAULT_MODEL = "gpt-5.5";
const FALLBACK_MODEL = "gpt-5.4-mini";
const allowedToolCommands = ["git:status", "git:diff", "typecheck", "build", "smoke"];

const agentGuidance = {
  pm: "你是产品 Agent，负责澄清目标、范围、验收标准和用户价值。",
  arch: "你是架构 Agent，负责拆解系统、定义模块边界、安排任务依赖和风险。",
  fe: "你是前端 Agent，负责界面结构、交互状态、可用性和前端实现方案。",
  qa: "你是测试 Agent，负责验收路径、失败分支、测试命令和质量风险。",
  ops: "你是部署 Agent，负责构建、预览、部署、回滚和运行状态。",
  code: "你是代码 Agent，负责代码变更、Git Diff、执行器结果和实现细节。",
};

export function getOrchestratorStatus() {
  const config = getProviderConfig();
  return {
    provider: config.provider,
    configured: config.configured,
    model: config.model,
    fallbackModel: config.fallbackModel,
    reasoningEffort: config.reasoningEffort,
    apiStyle: config.apiStyle,
    baseUrl: config.baseUrl,
  };
}

export async function orchestrateReply({ agents, thread, taskGraph, mode, selectedAgentId, userText }) {
  const targetAgentId = mode === "single" ? selectedAgentId : chooseAgent(userText);
  const targetAgent = agents.find((agent) => agent.id === targetAgentId) || agents[0];

  const providerConfig = getProviderConfig();

  if (!providerConfig.configured) {
    return {
      agentId: targetAgent.id,
      text: fallbackReply({
        targetAgent,
        userText,
        reason: `LLM Provider 未配置完整：${providerConfig.missing.join("、") || "缺少 API 配置"}。当前使用本地降级回复。`,
      }),
      chips: ["Local Fallback", targetAgent.name],
      provider: "fallback",
    };
  }

  const model = providerConfig.model;
  const reasoningEffort = providerConfig.reasoningEffort;
  const diff = await readGitDiff();
  const recentMessages = thread.messages.slice(-10).map((message) => ({
    role: message.user ? "user" : "assistant",
    speaker: message.user ? "用户" : agents.find((agent) => agent.id === message.agentId)?.name || "Agent",
    text: message.text,
  }));

  const prompt = [
    `当前会话: ${thread.title}`,
    `协作模式: ${mode === "single" ? "单聊" : "群聊"}`,
    `当前回复 Agent: ${targetAgent.name} - ${targetAgent.role}`,
    "",
    "最近消息:",
    JSON.stringify(recentMessages, null, 2),
    "",
    "任务图:",
    JSON.stringify(
      taskGraph.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        owner: node.owner,
        status: node.status,
        dependsOn: node.dependsOn,
        acceptanceCommand: node.acceptanceCommand,
      })),
      null,
      2,
    ),
    "",
    "Git Diff 摘要:",
    JSON.stringify(
      {
        available: diff.available,
        filesChanged: diff.filesChanged,
        insertions: diff.insertions,
        deletions: diff.deletions,
        status: diff.status
          ? {
              clean: diff.status.clean,
              counts: diff.status.counts,
              untracked: diff.status.untracked,
            }
          : undefined,
        error: diff.error,
      },
      null,
      2,
    ),
    "",
    `用户最新输入: ${userText}`,
    "",
    "请用中文回答。优先给出能继续推进项目的具体建议；如果需要工具执行，只能建议这些白名单命令：git:status、git:diff、typecheck、build、smoke。",
    "如果建议工具，请在回答末尾另起一行写标记，例如 [[tool:git:status]] 或 [[tool:typecheck]]。回答不要超过 5 段。",
    "如果需要同步任务图，可以在回答末尾另起一行写 JSON 标记：[[task:add:{\"id\":\"short-id\",\"title\":\"任务标题\",\"owner\":\"代码 Agent\",\"detail\":\"简短说明\",\"status\":\"todo\",\"dependsOn\":[\"local-api\"],\"acceptanceCommand\":\"smoke\"}]] 或 [[task:update:{\"id\":\"executor\",\"status\":\"running\",\"acceptanceCommand\":\"typecheck\"}]]。acceptanceCommand 只能是 git:status、git:diff、typecheck、build、smoke。只在确有必要时使用，最多 2 条。",
  ].join("\n");

  try {
    const rawText = await createProviderResponse({
      providerConfig,
      reasoningEffort,
      instructions: buildInstructions(targetAgent),
      input: prompt,
    });
    const parsed = parseOrchestratorOutput(rawText);

    return {
      agentId: targetAgent.id,
      text: parsed.text,
      chips: ["LLM", providerConfig.provider, model, targetAgent.name],
      toolSuggestions: parsed.toolSuggestions,
      taskMutations: parsed.taskMutations,
      provider: providerConfig.provider,
      model,
    };
  } catch (error) {
    const fallbackModel = providerConfig.fallbackModel;
    if (fallbackModel && fallbackModel !== model) {
      try {
        const rawText = await createProviderResponse({
          providerConfig: { ...providerConfig, model: fallbackModel },
          reasoningEffort,
          instructions: buildInstructions(targetAgent),
          input: prompt,
        });
        const parsed = parseOrchestratorOutput(rawText);
        return {
          agentId: targetAgent.id,
          text: parsed.text,
          chips: ["LLM", providerConfig.provider, fallbackModel, targetAgent.name],
          toolSuggestions: parsed.toolSuggestions,
          taskMutations: parsed.taskMutations,
          provider: providerConfig.provider,
          model: fallbackModel,
        };
      } catch {
        // Fall through to local fallback with the original error.
      }
    }

    return {
      agentId: targetAgent.id,
      text: fallbackReply({
        targetAgent,
        userText,
        reason: `LLM 请求失败：${error.message}`,
      }),
      chips: ["LLM Error", targetAgent.name],
      taskMutations: fallbackTaskMutations(userText, targetAgent),
      provider: "fallback",
      error: error.message,
    };
  }
}

export async function summarizeExecutorRun({ agents, thread, taskGraph, run }) {
  const targetAgentId = chooseExecutorAgent(run.command);
  const targetAgent = agents.find((agent) => agent.id === targetAgentId) || agents[0];
  const providerConfig = getProviderConfig();
  const outputExcerpt = clipText(run.output, 4000);

  if (!providerConfig.configured) {
    return {
      agentId: targetAgent.id,
      text: fallbackExecutorSummary({
        targetAgent,
        run,
        reason: `LLM Provider 未配置完整：${providerConfig.missing.join("、") || "缺少 API 配置"}。当前使用本地执行结果摘要。`,
      }),
      chips: ["Local Fallback", "Executor", run.status],
      provider: "fallback",
    };
  }

  const diff = await readGitDiff();
  const recentMessages = thread.messages.slice(-8).map((message) => ({
    role: message.user ? "user" : "assistant",
    speaker: message.user ? "用户" : agents.find((agent) => agent.id === message.agentId)?.name || "Agent",
    text: message.text,
  }));

  const prompt = [
    `当前会话: ${thread.title}`,
    `负责总结 Agent: ${targetAgent.name} - ${targetAgent.role}`,
    "",
    "刚刚完成的本地执行器运行:",
    JSON.stringify(
      {
        command: run.command,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        outputExcerpt,
      },
      null,
      2,
    ),
    "",
    "最近消息:",
    JSON.stringify(recentMessages, null, 2),
    "",
    "任务图:",
    JSON.stringify(
      taskGraph.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        owner: node.owner,
        status: node.status,
        dependsOn: node.dependsOn,
        acceptanceCommand: node.acceptanceCommand,
      })),
      null,
      2,
    ),
    "",
    "Git Diff 摘要:",
    JSON.stringify(
      {
        available: diff.available,
        filesChanged: diff.filesChanged,
        insertions: diff.insertions,
        deletions: diff.deletions,
        status: diff.status
          ? {
              clean: diff.status.clean,
              counts: diff.status.counts,
              untracked: diff.status.untracked,
            }
          : undefined,
        error: diff.error,
      },
      null,
      2,
    ),
    "",
    "请用中文总结这次工具结果：第一句明确命令成功或失败；然后说明它对当前 AgentHub 项目的影响；最后给一个最具体的下一步。",
    `如果需要继续使用工具，只能建议这些白名单命令：${allowedToolCommands.join("、")}。不要再次建议刚刚已经执行的 ${run.command}，除非输出明确要求复查。`,
    "如果建议工具，请在回答末尾另起一行写标记，例如 [[tool:typecheck]]。回答不要超过 4 段。",
  ].join("\n");

  try {
    const rawText = await createProviderResponse({
      providerConfig,
      reasoningEffort: providerConfig.reasoningEffort,
      instructions: buildExecutorInstructions(targetAgent),
      input: prompt,
    });
    const parsed = parseOrchestratorOutput(rawText, { excludeCommands: [run.command] });

    return {
      agentId: targetAgent.id,
      text: parsed.text,
      chips: ["LLM", providerConfig.provider, providerConfig.model, "Executor"],
      toolSuggestions: parsed.toolSuggestions,
      taskMutations: parsed.taskMutations,
      provider: providerConfig.provider,
      model: providerConfig.model,
    };
  } catch (error) {
    const fallbackModel = providerConfig.fallbackModel;
    if (fallbackModel && fallbackModel !== providerConfig.model) {
      try {
        const rawText = await createProviderResponse({
          providerConfig: { ...providerConfig, model: fallbackModel },
          reasoningEffort: providerConfig.reasoningEffort,
          instructions: buildExecutorInstructions(targetAgent),
          input: prompt,
        });
        const parsed = parseOrchestratorOutput(rawText, { excludeCommands: [run.command] });
        return {
          agentId: targetAgent.id,
          text: parsed.text,
          chips: ["LLM", providerConfig.provider, fallbackModel, "Executor"],
          toolSuggestions: parsed.toolSuggestions,
          taskMutations: parsed.taskMutations,
          provider: providerConfig.provider,
          model: fallbackModel,
        };
      } catch {
        // Fall through to local fallback with the original error.
      }
    }

    return {
      agentId: targetAgent.id,
      text: fallbackExecutorSummary({
        targetAgent,
        run,
        reason: `LLM 执行结果总结失败：${error.message}`,
      }),
      chips: ["LLM Error", "Executor", run.status],
      provider: "fallback",
      error: error.message,
    };
  }
}

function buildInstructions(agent) {
  return [
    "你是 AgentHub 多 Agent 协作平台里的一个专业 Agent。",
    agentGuidance[agent.id] || "你负责根据当前上下文推进任务。",
    "你必须基于提供的会话、任务图和 Git Diff 摘要回答，不要假装已经执行了未执行的命令。",
    "你可以建议下一步工具调用，但不能编造工具结果。",
    "回答要像协作 IM 里的专业同事：具体、简洁、可执行。",
  ].join("\n");
}

function buildExecutorInstructions(agent) {
  return [
    "你是 AgentHub 多 Agent 协作平台里的执行结果分析 Agent。",
    agentGuidance[agent.id] || "你负责根据本地工具输出推进任务。",
    "你必须只基于提供的执行器输出、会话、任务图和 Git Diff 摘要判断，不要编造未出现的日志。",
    "如果命令失败，要先指出失败信号，再给出可验证的修复或复查路径。",
    "回答要像协作 IM 里的专业同事：短、准、能直接推进下一步。",
  ].join("\n");
}

function getProviderConfig() {
  const explicitProvider = normalizeProvider(process.env.AGENTHUB_LLM_PROVIDER);
  const provider = explicitProvider || (process.env.AIGO_API_KEY ? "aigo" : process.env.OPENAI_API_KEY ? "openai" : "fallback");
  const reasoningEffort = process.env.AGENTHUB_REASONING_EFFORT || "low";
  const maxOutputTokens = Number(process.env.AGENTHUB_MAX_OUTPUT_TOKENS || 900);
  const timeoutMs = Number(process.env.AGENTHUB_LLM_TIMEOUT_MS || 30000);

  if (provider === "aigo") {
    const baseUrl = trimTrailingSlash(process.env.AIGO_BASE_URL || process.env.AGENTHUB_LLM_BASE_URL || "");
    const apiKey = process.env.AIGO_API_KEY || process.env.AGENTHUB_LLM_API_KEY || process.env.OPENAI_API_KEY || "";
    const apiStyle = normalizeApiStyle(process.env.AIGO_API_STYLE || process.env.AGENTHUB_LLM_API_STYLE || "chat");
    const missing = [];
    if (!apiKey) missing.push("AIGO_API_KEY 或 OPENAI_API_KEY");
    if (!baseUrl) missing.push("AIGO_BASE_URL");

    return {
      provider: "aigo",
      configured: missing.length === 0,
      apiKey,
      baseUrl,
      apiStyle,
      model: process.env.AIGO_MODEL || process.env.AGENTHUB_LLM_MODEL || process.env.AGENTHUB_OPENAI_MODEL || DEFAULT_MODEL,
      fallbackModel: process.env.AIGO_FALLBACK_MODEL || process.env.AGENTHUB_LLM_FALLBACK_MODEL || FALLBACK_MODEL,
      reasoningEffort,
      maxOutputTokens,
      timeoutMs,
      missing,
    };
  }

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AGENTHUB_LLM_API_KEY || "";
    const baseUrl = trimTrailingSlash(process.env.OPENAI_BASE_URL || process.env.AGENTHUB_LLM_BASE_URL || "https://api.openai.com/v1");
    const apiStyle = normalizeApiStyle(process.env.OPENAI_API_STYLE || process.env.AGENTHUB_LLM_API_STYLE || "responses");
    const missing = [];
    if (!apiKey) missing.push("OPENAI_API_KEY");

    return {
      provider: "openai",
      configured: missing.length === 0,
      apiKey,
      baseUrl,
      apiStyle,
      model: process.env.AGENTHUB_OPENAI_MODEL || process.env.OPENAI_MODEL || process.env.AGENTHUB_LLM_MODEL || DEFAULT_MODEL,
      fallbackModel: process.env.AGENTHUB_OPENAI_FALLBACK_MODEL || process.env.AGENTHUB_LLM_FALLBACK_MODEL || FALLBACK_MODEL,
      reasoningEffort,
      maxOutputTokens,
      timeoutMs,
      missing,
    };
  }

  return {
    provider: "fallback",
    configured: false,
    apiKey: "",
    baseUrl: "",
    apiStyle: "chat",
    model: process.env.AGENTHUB_LLM_MODEL || DEFAULT_MODEL,
    fallbackModel: process.env.AGENTHUB_LLM_FALLBACK_MODEL || FALLBACK_MODEL,
    reasoningEffort,
    maxOutputTokens,
    timeoutMs,
    missing: ["AGENTHUB_LLM_PROVIDER / API_KEY"],
  };
}

async function createProviderResponse({ providerConfig, reasoningEffort, instructions, input }) {
  if (providerConfig.apiStyle === "responses") {
    return createResponsesResponse({ providerConfig, reasoningEffort, instructions, input });
  }
  return createChatCompletion({ providerConfig, instructions, input });
}

async function createResponsesResponse({ providerConfig, reasoningEffort, instructions, input }) {
  const body = {
    model: providerConfig.model,
    instructions,
    input,
    max_output_tokens: providerConfig.maxOutputTokens,
  };

  if (reasoningEffort && reasoningEffort !== "none") {
    body.reasoning = { effort: reasoningEffort };
  }

  const response = await fetch(`${providerConfig.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(providerConfig.timeoutMs),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `${providerConfig.provider} responses request failed with ${response.status}`);
  }

  const text = extractOutputText(payload);
  if (!text) {
    throw new Error("OpenAI response did not include text output");
  }
  return text.trim();
}

async function createChatCompletion({ providerConfig, instructions, input }) {
  const response = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerConfig.model,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
      temperature: Number(process.env.AGENTHUB_TEMPERATURE || 0.2),
      max_tokens: providerConfig.maxOutputTokens,
    }),
    signal: AbortSignal.timeout(providerConfig.timeoutMs),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `${providerConfig.provider} chat request failed with ${response.status}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part.text || ""))
      .join("\n")
      .trim();
  }
  throw new Error(`${providerConfig.provider} chat response did not include text output`);
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function parseOrchestratorOutput(rawText, options = {}) {
  const taskResult = extractTaskMutations(rawText);
  const toolResult = extractToolSuggestions(taskResult.text, options);

  return {
    text: toolResult.text,
    toolSuggestions: toolResult.toolSuggestions,
    taskMutations: taskResult.taskMutations,
  };
}

function extractToolSuggestions(rawText, options = {}) {
  let text = String(rawText || "");
  const commands = new Set();
  const excludeCommands = new Set(options.excludeCommands || []);
  const markerPattern = /\[\[tool:([a-z:]+)\]\]/gi;
  let match;

  while ((match = markerPattern.exec(text)) !== null) {
    const command = normalizeToolCommand(match[1]);
    if (command && !excludeCommands.has(command)) commands.add(command);
  }

  text = text.replace(markerPattern, "").trim();

  for (const command of allowedToolCommands) {
    if (excludeCommands.has(command)) continue;
    if (new RegExp(`(^|[^\\w:-])${escapeRegExp(command)}([^\\w:-]|$)`, "i").test(text)) {
      commands.add(command);
    }
  }

  return {
    text,
    toolSuggestions: Array.from(commands).map((command) => ({
      id: `${command}-${Date.now()}`,
      command,
      title: toolTitle(command),
      reason: toolReason(command),
      status: "suggested",
    })),
  };
}

function extractTaskMutations(rawText) {
  let text = String(rawText || "");
  const taskMutations = [];
  const markerPattern = /\[\[task:(add|update):(\{[\s\S]*?\})\]\]/gi;
  let match;

  while ((match = markerPattern.exec(text)) !== null && taskMutations.length < 2) {
    const parsed = safeParseJson(match[2]);
    if (!parsed) continue;

    if (match[1].toLowerCase() === "add") {
      const mutation = normalizeTaskAddMutation(parsed);
      if (mutation) taskMutations.push(mutation);
    } else {
      const mutation = normalizeTaskUpdateMutation(parsed);
      if (mutation) taskMutations.push(mutation);
    }
  }

  text = text.replace(markerPattern, "").trim();
  return { text, taskMutations };
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeTaskAddMutation(value) {
  const title = sanitizeText(value.title, 80);
  if (!title) return undefined;

  return {
    type: "add",
    id: sanitizeTaskId(value.id || title),
    title,
    owner: sanitizeText(value.owner, 40),
    detail: sanitizeText(value.detail, 220),
    status: sanitizeStatus(value.status) || "todo",
    dependsOn: sanitizeDependsOn(value.dependsOn),
    acceptanceCommand: sanitizeCommand(value.acceptanceCommand),
  };
}

function normalizeTaskUpdateMutation(value) {
  const id = sanitizeTaskId(value.id);
  if (!id) return undefined;

  return {
    type: "update",
    id,
    title: sanitizeText(value.title, 80),
    owner: sanitizeText(value.owner, 40),
    detail: sanitizeText(value.detail, 220),
    status: sanitizeStatus(value.status),
    dependsOn: Array.isArray(value.dependsOn) ? sanitizeDependsOn(value.dependsOn) : undefined,
    acceptanceCommand: sanitizeCommand(value.acceptanceCommand),
  };
}

function sanitizeTaskId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function sanitizeText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function sanitizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return ["done", "running", "todo", "blocked"].includes(status) ? status : "";
}

function sanitizeDependsOn(value) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeTaskId).filter(Boolean).slice(0, 6);
}

function sanitizeCommand(value) {
  const command = String(value || "").trim().toLowerCase();
  return allowedToolCommands.includes(command) ? command : "";
}

function normalizeToolCommand(value) {
  const command = String(value || "").trim().toLowerCase();
  return allowedToolCommands.includes(command) ? command : "";
}

function toolTitle(command) {
  return {
    "git:status": "查看 Git 状态",
    "git:diff": "刷新 Git Diff",
    typecheck: "运行类型检查",
    build: "运行生产构建",
    smoke: "运行闭环 Smoke",
  }[command];
}

function toolReason(command) {
  return {
    "git:status": "确认当前工作区有哪些变更。",
    "git:diff": "读取当前代码变更摘要，供 Agent 继续分析。",
    typecheck: "验证 TypeScript 类型是否通过。",
    build: "验证当前前端构建是否可发布。",
    smoke: "验证本地 API、任务图、产物和执行器入口是否连通。",
  }[command];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["openai", "aigo", "fallback"].includes(normalized)) return normalized;
  return "";
}

function normalizeApiStyle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "responses" ? "responses" : "chat";
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function chooseExecutorAgent(command) {
  if (command.startsWith("git:")) return "code";
  if (command === "build") return "ops";
  if (command === "typecheck" || command === "smoke") return "qa";
  return "arch";
}

function chooseAgent(text) {
  const normalized = text.toLowerCase();
  if (/(部署|发布|预览|build|上线|回滚|环境)/i.test(normalized)) return "ops";
  if (/(测试|验收|bug|失败|质量|用例|typecheck|smoke)/i.test(normalized)) return "qa";
  if (/(代码|diff|git|实现|接口|api|执行器)/i.test(normalized)) return "code";
  if (/(页面|界面|按钮|样式|交互|前端|ui)/i.test(normalized)) return "fe";
  if (/(需求|用户|范围|产品|方案|规划)/i.test(normalized)) return "pm";
  return "arch";
}

function fallbackExecutorSummary({ targetAgent, run, reason }) {
  const output = clipText(run.output || "(no output)", 700);
  const statusText = run.status === "success" ? "成功" : "失败";
  const nextStep =
    run.status === "success"
      ? "下一步可以继续运行互补检查，或回到任务图推进下一个未完成节点。"
      : "下一步先根据右侧执行器输出定位失败原因，修复后再重新运行对应检查。";

  return [
    `${reason}`,
    "",
    `${targetAgent.name} 本地判断：${run.command} 执行${statusText}。`,
    `输出摘要：${output}`,
    nextStep,
  ].join("\n");
}

function fallbackReply({ targetAgent, userText, reason }) {
  return [
    `${reason}`,
    "",
    `${targetAgent.name} 先给出本地判断：你刚才的问题是“${userText}”。我会把它当作 ${targetAgent.role} 方向的问题继续推进。`,
    "下一步建议：配置 AIGO_API_KEY 或 OPENAI_API_KEY 后重试同一条消息；如果是在本地开发，可以先运行 git:status 或 typecheck，让我把真实工具结果写回会话。",
  ].join("\n");
}

function fallbackTaskMutations(userText, targetAgent) {
  if (!/(任务图|任务节点|同步任务|补充任务|新增任务|拆解)/i.test(userText)) {
    return [];
  }

  if (/(验收|测试|质量|typecheck|检查)/i.test(userText)) {
    return [
      {
        type: "add",
        id: "validate-agenthub-loop",
        title: "验证 AgentHub 闭环可用性",
        owner: "测试 Agent",
        detail: "用消息、任务图、执行器和工具建议串起一次端到端验收，确认结果能写回会话和任务图。",
        status: "todo",
        dependsOn: ["executor"],
      },
    ];
  }

  return [
    {
      type: "add",
      id: "agent-task-sync",
      title: "接通 Agent 到任务图的同步闭环",
      owner: targetAgent.name,
      detail: "将 Agent 回复中的下一步拆成可追踪任务，并在会话推进时更新任务状态。",
      status: "todo",
      dependsOn: ["executor"],
    },
  ];
}

function clipText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...（已截断 ${text.length - maxLength} 个字符）`;
}
