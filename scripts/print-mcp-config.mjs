import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log(
  JSON.stringify(
    {
      mcpServers: {
        "floorplan-studio": {
          command: process.execPath,
          args: [
            "--import",
            path.join(root, "node_modules/tsx/dist/loader.mjs"),
            path.join(root, "src/mcp/server.ts"),
          ],
          env: {
            FLOORPLAN_API_URL:
              process.env.FLOORPLAN_API_URL ?? "http://127.0.0.1:3000",
            FLOORPLAN_DATA_DIR:
              process.env.FLOORPLAN_DATA_DIR ?? path.join(root, ".data"),
          },
        },
      },
    },
    null,
    2,
  ),
);
