import { z } from "zod";
import { RuleError } from "../domain/engine";
import { accounts, emailSchema, registrationEnabled } from "./accounts";
import { authEnabled, configuredOrigin, getRuntime } from "./runtime";
import {
  checkLoginRate,
  issueSession,
  requireUserMutation,
  sessionCookie,
  settings,
  validateOrigin,
} from "./auth";
import { errorResponse, limitedJson } from "./http";
import { claimLegacyProjects } from "./repositories/legacy-projects";

type Action =
  "register" | "login" | "verify" | "resend" | "forgot" | "reset" | "email";
const genericMail = {
  ok: true,
  message: "如果该邮箱符合条件，我们会发送邮件，请检查收件箱和垃圾邮件。",
};
export function authAction(action: Action) {
  return async (request: Request) => {
    try {
      const runtime = await getRuntime();
      validateOrigin(request, runtime);
      if (!authEnabled(runtime)) {
        if (action === "login")
          return Response.json(
            { ok: true },
            { headers: { "Cache-Control": "no-store" } },
          );
        throw new RuleError(
          "LOGIN_NOT_ENABLED",
          "请配置 SESSION_SECRET 和 APP_ORIGIN 以启用账号功能。",
          503,
        );
      }
      settings(runtime);
      const identity =
        action === "email" ? await requireUserMutation(request, runtime) : null;
      if (action === "register" && !registrationEnabled(runtime))
        throw new RuleError(
          "REGISTRATION_DISABLED",
          "当前站点已关闭注册。",
          403,
        );
      await checkLoginRate(
        request,
        runtime,
        action,
        action === "login" ? 10 : 6,
      );
      const body = await limitedJson(request, 8192),
        service = await accounts(runtime);
      if (["register", "resend", "forgot", "email"].includes(action)) {
        const email = emailSchema.parse((body as { email?: unknown })?.email);
        await checkLoginRate(request, runtime, `${action}:recipient`, 3, email);
      }
      let result: unknown = { ok: true };
      let cookie: string | undefined;
      if (action === "login") {
        const input = z
          .object({
            username: z.string().max(254),
            password: z.string().max(256),
          })
          .parse(body);
        const user = await service.authenticate(input.username, input.password);
        await claimLegacyProjects(runtime, user);
        const session = await issueSession(runtime, request, user);
        cookie = sessionCookie(
          session.token,
          configuredOrigin(runtime, request),
        );
        result = { ok: true, csrf: session.csrf };
      } else if (action === "register") {
        await service.register(body);
        result = genericMail;
      } else if (action === "verify") {
        const input = z.object({ token: z.string().max(128) }).parse(body);
        await service.verify(input.token);
      } else if (action === "reset") {
        const input = z
          .object({
            token: z.string().max(128),
            password: z.string().min(8).max(24),
          })
          .parse(body);
        await service.reset(input.token, input.password);
      } else if (action === "email") {
        if (!identity) throw new RuleError("LOGIN_REQUIRED", "请先登录。", 401);
        const input = z
          .object({ email: emailSchema, password: z.string().max(256) })
          .parse(body);
        await service.bindEmail(identity.userId, input.email, input.password);
        result = genericMail;
      } else {
        const input = z.object({ email: emailSchema }).parse(body);
        if (action === "resend") await service.resend(input.email);
        else await service.forgot(input.email);
        result = genericMail;
      }
      return Response.json(result, {
        status: action === "register" ? 201 : 200,
        headers: {
          "Cache-Control": "no-store",
          ...(cookie ? { "Set-Cookie": cookie } : {}),
        },
      });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
