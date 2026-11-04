import { requireUser } from "@/server/auth";
import { authEnabled, getRuntime } from "@/server/runtime";
import { errorResponse } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const runtime = await getRuntime(),
      session = await requireUser(request, runtime);
    return Response.json(
      {
        authenticated: true,
        authEnabled: authEnabled(runtime),
        username: session?.username ?? null,
        userId: session?.userId ?? null,
        csrf: session?.csrf ?? null,
        mode: runtime.mode,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
