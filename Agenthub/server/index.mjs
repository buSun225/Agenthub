import http from "node:http";
import {
  addAgentReply,
  addSystemAgentMessage,
  addUserMessage,
  applyTaskMutations,
  agents,
  createThread,
  deployment,
  executorRuns,
  findThread,
  findTask,
  generateTask,
  resetRuntimeState,
  taskGraph,
  threads,
  toggleTask,
  updateDeployment,
} from "./state.mjs";
import { readGitDiff, readGitStatus } from "./git.mjs";
import { allowedCommands, runExecutor } from "./executor.mjs";
import { getOrchestratorStatus, orchestrateReply, summarizeExecutorRun } from "./orchestrator.mjs";

const port = Number(process.env.AGENTHUB_API_PORT || 8787);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "OPTIONS") {
      send(response, 204, null);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      send(response, 200, {
        agents,
        threads,
        taskGraph,
        diff: await readGitDiff(),
        executorRuns,
        deployment,
        orchestrator: getOrchestratorStatus(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/state/reset") {
      resetRuntimeState();
      send(response, 200, {
        agents,
        threads,
        taskGraph,
        diff: await readGitDiff(),
        executorRuns,
        deployment,
        orchestrator: getOrchestratorStatus(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/threads") {
      const body = await readBody(request);
      send(response, 201, createThread(body.title));
      return;
    }

    const messageMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
    if (request.method === "POST" && messageMatch) {
      const body = await readBody(request);
      const text = String(body.text || "").trim();
      if (!text) throw badRequest("Message text is required");
      const thread = addUserMessage(messageMatch[1], text);
      const mode = body.mode === "single" ? "single" : "group";
      const reply = await orchestrateReply({
        agents,
        thread,
        taskGraph,
        mode,
        selectedAgentId: body.agentId || "arch",
        userText: text,
      });
      addAgentReply(thread, mode, body.agentId || "arch", text, reply);
      send(response, 200, thread);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/task-graph/generate") {
      const body = await readBody(request);
      send(response, 200, generateTask(body));
      return;
    }

    const toggleMatch = url.pathname.match(/^\/api\/task-graph\/([^/]+)\/toggle$/);
    if (request.method === "POST" && toggleMatch) {
      send(response, 200, toggleTask(toggleMatch[1]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/git/diff") {
      send(response, 200, await readGitDiff());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/git/status") {
      send(response, 200, await readGitStatus());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/executor/run") {
      const body = await readBody(request);
      const threadId = body.threadId || "group";
      const task = body.taskId ? findTask(body.taskId) : undefined;
      if (body.taskId && !task) throw badRequest("Task not found");
      const command = task?.acceptanceCommand || body.command;
      const run = await runExecutor(command, { threadId, taskId: task?.id });
      const thread = findThread(threadId);
      const summary = await summarizeExecutorRun({ agents, thread, taskGraph, run });
      addSystemAgentMessage({
        agentId: summary.agentId,
        threadId,
        text: summary.text,
        chips: summary.chips,
        toolSuggestions: summary.toolSuggestions || [],
      });
      applyTaskMutations(summary.taskMutations || [], { source: "agent", agentId: summary.agentId });
      send(response, 200, run);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/executor/commands") {
      send(response, 200, { commands: allowedCommands() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/deployments/preview") {
      updateDeployment({
        status: "building",
        logs: ["install dependencies", "run workspace build", "publish preview channel"],
      });
      setTimeout(() => {
        updateDeployment({
          status: "live",
          url: "https://preview.agenthub.local/run/local",
          logs: ["build completed", "checks passed", "preview live: /run/local"],
        });
      }, 700);
      send(response, 200, deployment);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/threads/")) {
      const threadId = url.pathname.split("/").at(-1);
      send(response, 200, findThread(threadId));
      return;
    }

    send(response, 404, { error: "Not found" });
  } catch (error) {
    send(response, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AgentHub API listening on http://127.0.0.1:${port}`);
});

function send(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload === null ? "" : JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(badRequest("Request body is too large"));
      }
    });
    request.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(badRequest("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
