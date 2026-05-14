import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { addExecutorRun, completeExecutorRun } from "./state.mjs";

const repoRoot = new URL("..", import.meta.url);

const commandMap = new Map([
  ["typecheck", { file: "npm", args: ["run", "typecheck"] }],
  ["build", { file: "npm", args: ["run", "build"] }],
  ["smoke", { file: "npm", args: ["run", "smoke"] }],
  ["git:status", { file: "git", args: ["status", "--short", "--untracked-files=all"] }],
  ["git:diff", { file: "git", args: ["diff", "--stat"] }],
]);

export function allowedCommands() {
  return Array.from(commandMap.keys());
}

export async function runExecutor(command, options = {}) {
  const selected = commandMap.get(command);
  if (!selected) {
    const error = new Error(`Command is not allowed. Allowed commands: ${allowedCommands().join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const run = addExecutorRun({
    id: randomUUID(),
    command,
    taskId: options.taskId,
    status: "running",
    output: "",
    startedAt: new Date().toISOString(),
  });

  return new Promise((resolve) => {
    execFile(
      selected.file,
      selected.args,
      { cwd: repoRoot, maxBuffer: 1024 * 1024 * 8, shell: process.platform === "win32" },
      (error, stdout, stderr) => {
        const completed = completeExecutorRun(run.id, {
          status: error ? "failed" : "success",
          output: `${stdout || ""}${stderr || ""}`.trim() || "(no output)",
          finishedAt: new Date().toISOString(),
        }, options);
        resolve(completed || run);
      },
    );
  });
}
