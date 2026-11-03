import { exportProject } from "@/server/store";
import { errorResponse } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(await exportProject((await params).id), {
      headers: {
        "Content-Disposition": 'attachment; filename="floorplan.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
