import path from "node:path";
import { z } from "zod";
import { requireUser, requireUserMutation } from "@/server/auth";
import {
  authEnabled,
  configuredOrigin,
  getRuntime,
  type AppRuntime,
} from "@/server/runtime";
import { userMcpTokens } from "@/server/mcp-tokens";
import { errorResponse, limitedJson } from "@/server/http";
import { RuleError } from "@/domain/engine";
export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "no-store" } };
async function configuration(
  runtime: AppRuntime,
  request: Request,
  token?: string | null,
) {
  if (authEnabled(runtime) || runtime.env.APP_ORIGIN) {
    return {
      mcpServers: {
        "floorplan-studio": {
          url: `${configuredOrigin(runtime, request)}/api/mcp`,
          headers: {
            Authorization: `Bearer ${token ?? "<your personal MCP token>"}`,
          },
        },
      },
      codex: {
        url: `${configuredOrigin(runtime, request)}/api/mcp`,
        bearer_token_env_var: "FLOORPLAN_MCP_TOKEN",
      },
    };
  }
  const { dataDirectory } = await import("@/server/repositories/local");
  return {
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
  };
}
export async function GET(request: Request) {
  try {
    const runtime = await getRuntime(),
      session = await requireUser(request, runtime);
    const credential = session
      ? {
          username: session.username,
          ...(await (await userMcpTokens(runtime)).status(session.username)),
          issued: false,
        }
      : null;
    return Response.json(
      { ...(await configuration(runtime, request)), credential },
      noStore,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const runtime = await getRuntime(),
      session = await requireUserMutation(request, runtime);
    if (!session)
      throw new RuleError(
        "LOGIN_REQUIRED",
        "请启用网站登录后生成个人 MCP 令牌。",
        401,
      );
    const { action } = z
      .object({ action: z.enum(["create", "rotate"]) })
      .parse(await limitedJson(request, 1024));
    const { token, ...status } = await (
      await userMcpTokens(runtime)
    ).issue(session.username, action === "rotate");
    return Response.json(
      {
        ...(await configuration(runtime, request, token)),
        credential: { username: session.username, ...status, issued: !!token },
      },
      noStore,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
