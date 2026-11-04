import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.FLOORPLAN_DATA_DIR = path.resolve(
  root,
  process.env.FLOORPLAN_DATA_DIR ?? ".data",
);
const { createMcpServer } = await import("./create-server");
const { localToken } = await import("../server/repositories/local");
const base = (process.env.FLOORPLAN_API_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const api = async (path: string, body?: unknown) => {
  const credential =
    process.env.FLOORPLAN_MCP_TOKEN ??
    process.env.MCP_TOKEN ??
    (await localToken());
  const response = await fetch(`${base}/api/agent/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${credential}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(`${data.code ?? response.status}: ${data.error}`);
  return data;
};
await createMcpServer(api).connect(new StdioServerTransport());
