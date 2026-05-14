import { execFile } from "node:child_process";

const repoRoot = new URL("..", import.meta.url);

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 6 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export async function readGitDiff() {
  try {
    const [stat, raw, status] = await Promise.all([
      runGit(["diff", "--shortstat"]),
      runGit(["diff", "--", "."]),
      readGitStatus(),
    ]);
    const summary = parseShortStat(stat);
    return {
      available: true,
      raw: raw || "No unstaged diff in the AgentHub workspace.",
      status,
      ...summary,
    };
  } catch (error) {
    return {
      available: false,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      raw: "",
      status: emptyStatus(error.stderr || error.message),
      error: error.stderr || error.message,
    };
  }
}

export async function readGitStatus() {
  try {
    const raw = await runGit(["status", "--short", "--untracked-files=all"]);
    return parseStatus(raw);
  } catch (error) {
    return emptyStatus(error.stderr || error.message);
  }
}

function parseShortStat(stat) {
  const files = stat.match(/(\d+) files? changed/);
  const insertions = stat.match(/(\d+) insertions?\(\+\)/);
  const deletions = stat.match(/(\d+) deletions?\(-\)/);
  return {
    filesChanged: files ? Number(files[1]) : 0,
    insertions: insertions ? Number(insertions[1]) : 0,
    deletions: deletions ? Number(deletions[1]) : 0,
  };
}

function parseStatus(raw) {
  const entries = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseStatusLine);

  return {
    available: true,
    clean: entries.length === 0,
    raw: raw || "",
    entries,
    counts: {
      total: entries.length,
      tracked: entries.filter((entry) => entry.kind !== "untracked").length,
      untracked: entries.filter((entry) => entry.kind === "untracked").length,
      external: entries.filter((entry) => entry.scope === "external").length,
    },
    untracked: entries.filter((entry) => entry.kind === "untracked"),
  };
}

function parseStatusLine(line) {
  const code = line.slice(0, 2);
  const path = line.slice(3).trim();
  const kind = code === "??" ? "untracked" : "tracked";
  return {
    code,
    path,
    kind,
    scope: path.startsWith("../") ? "external" : "workspace",
    category: categorizePath(path, kind),
  };
}

function categorizePath(path, kind) {
  if (kind !== "untracked") return "tracked-change";
  if (path === "../.gitignore") return "repo-config";
  if (path.startsWith("../hatch-runs/") || path.startsWith("../hatch-pet-runs/")) return "ignore-candidate";
  if (/\.log$/i.test(path) || /\.tsbuildinfo$/i.test(path)) return "runtime-log";
  if (path.startsWith("dist/") || path.startsWith("node_modules/") || path.startsWith(".agenthub/")) return "runtime-artifact";
  return "project-source";
}

function emptyStatus(error = "") {
  return {
    available: !error,
    clean: !error,
    raw: "",
    entries: [],
    counts: {
      total: 0,
      tracked: 0,
      untracked: 0,
      external: 0,
    },
    untracked: [],
    error: error || undefined,
  };
}
