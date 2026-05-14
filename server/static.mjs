import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "dist");
const port = Number(process.env.AGENTHUB_WEB_PORT || 5173);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const filePath = path.resolve(root, requestedPath === "/" ? "index.html" : `.${requestedPath}`);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (!error) {
      response.writeHead(200, {
        "Content-Type": types.get(path.extname(filePath)) || "application/octet-stream",
      });
      response.end(content);
      return;
    }

    fs.readFile(path.join(root, "index.html"), (fallbackError, fallback) => {
      if (fallbackError) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("AgentHub dist not found. Run npm run build first.");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fallback);
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AgentHub Web listening on http://127.0.0.1:${port}`);
});
