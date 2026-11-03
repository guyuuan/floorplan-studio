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
await createMcpServer().connect(new StdioServerTransport());
