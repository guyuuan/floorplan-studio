import { z } from "zod";
import { authEnabled, configuredOrigin, getRuntime } from "@/server/runtime";
import {
  checkLoginRate,
  constantTimeEqual,
  issueSession,
  sessionCookie,
  settings,
  validateOrigin,
} from "@/server/auth";
import { errorResponse, limitedJson } from "@/server/http";
import { RuleError } from "@/domain/engine";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const runtime = await getRuntime();
    validateOrigin(request, runtime);
    if (!authEnabled(runtime))
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    const config = settings(runtime);
    await checkLoginRate(request, runtime);
    const credentials = z
      .object({ username: z.string().max(200), password: z.string().max(1000) })
      .parse(await limitedJson(request, 4096));
    const [validUser, validPassword] = await Promise.all([
      constantTimeEqual(credentials.username, config.username),
      constantTimeEqual(credentials.password, config.password),
    ]);
    if (!validUser || !validPassword)
      throw new RuleError("INVALID_CREDENTIALS", "账号或密码不正确。", 401);
    const session = await issueSession(runtime, request);
    return Response.json(
      { ok: true, csrf: session.csrf },
      {
        headers: {
          "Set-Cookie": sessionCookie(
            session.token,
            configuredOrigin(runtime, request),
          ),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
