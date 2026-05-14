import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const apiPort = Number(process.env.AGENTHUB_SMOKE_PORT || 9876);
const baseUrl = `http://127.0.0.1:${apiPort}`;
const checks = [];
const stateDir = mkdtempSync(path.join(tmpdir(), "agenthub-smoke-"));

const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    AGENTHUB_API_PORT: String(apiPort),
    AGENTHUB_STATE_DIR: stateDir,
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
  await waitForApi();
  const bootstrap = await getJson("/api/bootstrap");
  assert(Array.isArray(bootstrap.threads) && bootstrap.threads.length > 0, "bootstrap returns threads");
  assert(Array.isArray(bootstrap.taskGraph?.nodes) && bootstrap.taskGraph.nodes.length > 0, "bootstrap returns task graph");
  assert(Array.isArray(bootstrap.artifacts), "bootstrap returns artifacts");
  assert(bootstrap.orchestrator?.provider, "bootstrap returns orchestrator status");

  const commands = await getJson("/api/executor/commands");
  for (const command of ["git:status", "git:diff", "typecheck", "build", "smoke"]) {
    assert(commands.commands.includes(command), `executor allows ${command}`);
  }

  const thread = await postJson("/api/threads", { title: "Smoke 会话" });
  assert(thread.id, "can create thread");

  const fetchedThread = await getJson(`/api/threads/${thread.id}`);
  assert(fetchedThread.id === thread.id, "can read created thread");

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
  rmSync(stateDir, { recursive: true, force: true });
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
