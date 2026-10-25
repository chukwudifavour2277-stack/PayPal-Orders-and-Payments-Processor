import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const indexHtml = await readFile(resolve(currentDirectory, "../public/index.html"), "utf8");
const port = Number(process.env.PORT ?? "3000");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(method === "HEAD" ? undefined : "Method not allowed");
    return;
  }

  if (pathname === "/health") {
    sendJson(response, 200, { status: "ok", service: "paypal-autonomous-os" });
    return;
  }

  if (pathname !== "/") {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(method === "HEAD" ? undefined : "Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(method === "HEAD" ? undefined : indexHtml);
}

const server = createServer(handleRequest);

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`PayPal Autonomous OS starter listening on port ${port}\n`);
});

server.on("error", (error: Error) => {
  process.stderr.write(`Unable to start the server: ${error.message}\n`);
  process.exitCode = 1;
});
