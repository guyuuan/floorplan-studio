import { getProjectService } from "@/server/store";
import { createAgentApi } from "@/server/agent-api";
import { errorResponse, limitedJson, requireAgent } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, { params }: Context) {
  try {
    await requireAgent(request);
    const path = (await params).path.map(encodeURIComponent).join("/");
    return Response.json(
      await createAgentApi(await getProjectService())(path),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    await requireAgent(request);
    const path = (await params).path.map(encodeURIComponent).join("/");
    const data = await createAgentApi(await getProjectService())(
      path,
      await limitedJson(request),
    );
    return Response.json(data, {
      status: path === "projects" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
