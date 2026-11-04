import { getProjectService } from "@/server/store";
import { requireUser } from "@/server/auth";
import { errorResponse, requireBrowser } from "@/server/http";
import { RuleError } from "@/domain/engine";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    const identity = await requireBrowser(request);
    const id = (await params).id;
    const reader = request.body?.getReader();
    if (!reader) throw new RuleError("EMPTY_BODY", "PNG 内容为空。", 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 10 * 1024 * 1024) {
        await reader.cancel();
        throw new RuleError("TOO_LARGE", "PNG 不能超过 10 MB。", 413);
      }
      chunks.push(value);
    }
    await (
      await getProjectService(identity?.userId)
    ).savePng(id, Buffer.concat(chunks));
    return Response.json(
      { ok: true, url: `/api/projects/${id}/png` },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request, { params }: Context) {
  try {
    const identity = await requireUser(request);
    const bytes = await (
      await getProjectService(identity?.userId)
    ).getPng((await params).id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="floorplan.png"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
