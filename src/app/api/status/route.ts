import { requireUser } from "@/server/auth";
import { getRuntime } from "@/server/runtime";
import { errorResponse } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireUser(request);
    const runtime = await getRuntime();
    return Response.json(
      {
        ok: true,
        mode: runtime.mode,
        mcp: "streamable-http",
        assistant: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
