import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const apiPort = Number(process.env.AGENTHUB_SMOKE_PORT || 9876);
const llmPort = Number(process.env.AGENTHUB_SMOKE_LLM_PORT || 9877);
const baseUrl = `http://127.0.0.1:${apiPort}`;
const llmBaseUrl = `http://127.0.0.1:${llmPort}/v1`;
const checks = [];
const stateDir = mkdtempSync(path.join(tmpdir(), "agenthub-smoke-"));
let llmMode = "success";

const llmServer = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }

  request.resume();

  if (llmMode === "forbidden") {
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "mock forbidden" } }));
    return;
  }

  if (llmMode === "empty") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "" } }] }));
    return;
  }

  if (llmMode === "timeout") {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "late mock reply" } }] }));
    }, 250);
    return;
  }

  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: "mock LLM reply [[tool:git:status]]" } }] }));
});

const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    AGENTHUB_API_PORT: String(apiPort),
    AGENTHUB_STATE_DIR: stateDir,
    AGENTHUB_LLM_PROVIDER: "openai",
    OPENAI_BASE_URL: llmBaseUrl,
    OPENAI_API_KEY: "smoke-key",
    OPENAI_API_STYLE: "chat",
    AGENTHUB_OPENAI_MODEL: "mock-model",
    AGENTHUB_OPENAI_FALLBACK_MODEL: "mock-model",
    AGENTHUB_LLM_TIMEOUT_MS: "80",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk;
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});

try {
  await listen(llmServer, llmPort);
  await waitForApi();
  const bootstrap = await getJson("/api/bootstrap");
  assert(Array.isArray(bootstrap.threads) && bootstrap.threads.length > 0, "bootstrap returns threads");
  assert(Array.isArray(bootstrap.taskGraph?.nodes) && bootstrap.taskGraph.nodes.length > 0, "bootstrap returns task graph");
  assert(Array.isArray(bootstrap.artifacts), "bootstrap returns artifacts");
  assert(bootstrap.orchestrator?.provider, "bootstrap returns orchestrator status");
  assert(bootstrap.orchestrator?.configured === true, "orchestrator is configured for mock LLM");

  const commands = await getJson("/api/executor/commands");
  for (const command of ["git:status", "git:diff", "typecheck", "build", "smoke"]) {
    assert(commands.commands.includes(command), `executor allows ${command}`);
  }

  const diff = await getJson("/api/git/diff");
  assert(diff.available === true && diff.status?.available === true, "git diff endpoint returns structured status");

  const gitRun = await postJson("/api/executor/run", { command: "git:diff", threadId: "group" });
  assert(gitRun.command === "git:diff" && gitRun.status === "success", "executor can run git:diff");

  const thread = await postJson("/api/threads", { title: "Smoke 会话" });
  assert(thread.id, "can create thread");

  const fetchedThread = await getJson(`/api/threads/${thread.id}`);
  assert(fetchedThread.id === thread.id, "can read created thread");

  llmMode = "success";
  const successThread = await postJson(`/api/threads/${thread.id}/messages`, {
    text: "mock success",
    mode: "group",
    agentId: "arch",
  });
  const successReply = successThread.messages.at(-1);
  assert(successReply.chips?.includes("LLM"), "mock LLM success writes assistant reply");
  assert(successReply.toolSuggestions?.some((item) => item.command === "git:status"), "tool marker becomes suggestion");

  llmMode = "forbidden";
  const forbiddenThread = await postJson(`/api/threads/${thread.id}/messages`, {
    text: "mock forbidden",
    mode: "group",
    agentId: "arch",
  });
  const forbiddenReply = forbiddenThread.messages.at(-1);
  assert(forbiddenReply.chips?.includes("LLM Error"), "403 failure falls back into thread");
  assert(/权限|API Key|第三方/.test(forbiddenReply.text), "403 fallback gives actionable permission hint");

  llmMode = "empty";
  const emptyThread = await postJson(`/api/threads/${thread.id}/messages`, {
    text: "mock empty",
    mode: "group",
    agentId: "arch",
  });
  const emptyReply = emptyThread.messages.at(-1);
  assert(emptyReply.chips?.includes("LLM Error"), "empty response falls back into thread");
  assert(/有效文本|响应格式|API style/.test(emptyReply.text), "empty response hint is actionable");

  llmMode = "timeout";
  const timeoutThread = await postJson(`/api/threads/${thread.id}/messages`, {
    text: "mock timeout",
    mode: "group",
    agentId: "arch",
  });
  const timeoutReply = timeoutThread.messages.at(-1);
  assert(timeoutReply.chips?.includes("LLM Error"), "timeout falls back into thread");
  assert(/超时|AGENTHUB_LLM_TIMEOUT_MS|模型/.test(timeoutReply.text), "timeout hint is actionable");

  console.log(`Smoke checks passed (${checks.length}).`);
} catch (error) {
  console.error("Smoke checks failed.");
  console.error(error.message);
  if (serverOutput.trim()) {
    console.error("Server output:");
    console.error(serverOutput.trim());
  }
  process.exitCode = 1;
} finally {
  server.kill();
  await closeServer(llmServer);
  rmSync(stateDir, { recursive: true, force: true });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function waitForApi() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      await getJson("/api/bootstrap");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`API did not start on ${baseUrl}`);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} failed with ${response.status}`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}`);
  return response.json();
}

function assert(condition, label) {
  if (!condition) throw new Error(`Check failed: ${label}`);
  checks.push(label);
  console.log(`ok - ${label}`);
}
