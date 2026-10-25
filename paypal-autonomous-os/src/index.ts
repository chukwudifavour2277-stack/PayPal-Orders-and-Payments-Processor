import "dotenv/config";
import cors from "cors";
import express from "express";
import { resolve } from "node:path";

const app = express();
const port = Number(process.env.PORT ?? "3000");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "paypal-autonomous-mesh-os" });
});

app.use(express.static(resolve(__dirname, "../public")));
app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

const server = app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`PayPal Autonomous OS starter listening on port ${port}\n`);
});

server.on("error", (error: Error) => {
  process.stderr.write(`Unable to start the server: ${error.message}\n`);
  process.exitCode = 1;
});
