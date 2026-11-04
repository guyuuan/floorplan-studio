import { requireUser } from "@/server/auth";
import { getProjectService } from "@/server/store";
import { errorResponse } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await requireUser(request);
    return Response.json(
      await (
        await getProjectService(identity?.userId)
      ).exportProject((await params).id),
      {
        headers: {
          "Content-Disposition": 'attachment; filename="floorplan.json"',
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
