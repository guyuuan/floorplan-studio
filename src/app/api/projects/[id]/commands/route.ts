import { mutateProject } from "@/server/store";
import { errorResponse, limitedJson, requireBrowser } from "@/server/http";
import { batchSchema } from "@/domain/schema";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireBrowser(request);
    const b = batchSchema.parse(await limitedJson(request));
    return Response.json(
      await mutateProject(
        (await params).id,
        b.expectedRevision,
        b.commands,
        "user",
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
