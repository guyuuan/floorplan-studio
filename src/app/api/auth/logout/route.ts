import { requireUserMutation, sessionCookie } from "@/server/auth";
import { configuredOrigin, getRuntime } from "@/server/runtime";
import { errorResponse } from "@/server/http";
export async function POST(request: Request) {
  try {
    await requireUserMutation(request);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": sessionCookie(
            "",
            configuredOrigin(await getRuntime(), request),
            true,
          ),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
