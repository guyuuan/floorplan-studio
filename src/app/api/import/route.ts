import { getProjectService } from "@/server/store";
import { errorResponse, limitedJson, requireBrowser } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const identity = await requireBrowser(request);
    return Response.json(
      await (
        await getProjectService(identity?.userId)
      ).importProject(await limitedJson(request)),
      {
        status: 201,
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
