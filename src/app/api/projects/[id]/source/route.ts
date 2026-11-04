import { requireUser } from "@/server/auth";
import { sourceImage } from "@/server/store";
import { errorResponse } from "@/server/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser(request);
    const s = await sourceImage((await params).id);
    return new Response(new Uint8Array(s.data), {
      headers: {
        "Content-Type": s.meta.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
