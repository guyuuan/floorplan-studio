import path from "node:path";
import { dataDirectory, token } from "@/server/store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  await token();
  const host = request.headers.get("host") ?? new URL(request.url).host;
  return Response.json({
    mcpServers: {
      "floorplan-studio": {
        command: process.execPath,
        args: [
          "--import",
          path.join(process.cwd(), "node_modules/tsx/dist/loader.mjs"),
          path.join(process.cwd(), "src/mcp/server.ts"),
        ],
        env: {
          FLOORPLAN_API_URL: `${new URL(request.url).protocol}//${host}`,
          FLOORPLAN_DATA_DIR: dataDirectory,
        },
      },
    },
  });
}
