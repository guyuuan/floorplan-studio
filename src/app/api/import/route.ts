import { importProject } from "@/server/store";
import { errorResponse, limitedJson, requireBrowser } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireBrowser(request);
    return Response.json(await importProject(await limitedJson(request)), {
      status: 201,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
