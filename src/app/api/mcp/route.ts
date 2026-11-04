import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/mcp/create-server";
import { getProjectService } from "@/server/store";
import { createAgentApi } from "@/server/agent-api";
import { requireMcp } from "@/server/auth";
import { errorResponse, limitedJson } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireMcp(request);
    const body = await limitedJson(request);
    const server = createMcpServer(createAgentApi(await getProjectService()));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request, {
        parsedBody: body,
      });
      response.headers.set("Cache-Control", "no-store");
      return response;
    } finally {
      await server.close();
    }
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request) {
  try {
    await requireMcp(request);
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export const DELETE = GET;
