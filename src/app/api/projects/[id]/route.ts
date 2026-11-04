import { getProjectService } from "@/server/store";
import { requireUser } from "@/server/auth";
import { errorResponse } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await requireUser(request);
    const id = (await params).id,
      service = await getProjectService(identity?.userId);
    const revision = await service.revision(id),
      etag = `"revision:${revision}"`;
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "private, no-cache" },
      });
    const project = await service.getProject(id);
    return Response.json(project, {
      headers: {
        ETag: `"revision:${project.revision}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
