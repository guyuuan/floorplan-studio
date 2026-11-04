import path from "node:path";
import { requireUser } from "@/server/auth";
import { configuredOrigin, getRuntime } from "@/server/runtime";
import { errorResponse } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireUser(request);
    const runtime = await getRuntime();
    if (runtime.mode === "cloudflare" || runtime.env.APP_ORIGIN) {
      return Response.json(
        {
          mcpServers: {
            "floorplan-studio": {
              url: `${configuredOrigin(runtime, request)}/api/mcp`,
              headers: { Authorization: "Bearer <your MCP_TOKEN>" },
            },
          },
          codex: {
            url: `${configuredOrigin(runtime, request)}/api/mcp`,
            bearer_token_env_var: "FLOORPLAN_MCP_TOKEN",
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { dataDirectory } = await import("@/server/repositories/local");
    return Response.json(
      {
        mcpServers: {
          "floorplan-studio": {
            command: process.execPath,
            args: [
              "--import",
              path.join(process.cwd(), "node_modules/tsx/dist/loader.mjs"),
              path.join(process.cwd(), "src/mcp/server.ts"),
            ],
            env: {
              FLOORPLAN_API_URL: configuredOrigin(runtime, request),
              FLOORPLAN_DATA_DIR: dataDirectory,
            },
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
