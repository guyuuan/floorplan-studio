import { getProjectService } from "@/server/store";
import { migrateProject } from "@/server/migration";
import { errorResponse, limitedJson, requireBrowser } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireBrowser(request);
    const result = await migrateProject(
      await getProjectService(),
      await limitedJson(request),
    );
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
