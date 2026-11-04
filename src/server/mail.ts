import { RuleError } from "../domain/engine";
import type { AppRuntime } from "./runtime";
export type AccountMail = {
  to: string;
  purpose: "verify" | "reset";
  url: string;
  id: string;
};
export interface Mailer {
  send(mail: AccountMail): Promise<void>;
}
export function accountMailer(runtime: AppRuntime): Mailer {
  const { RESEND_API_KEY: key, EMAIL_FROM: from } = runtime.env;
  if (!key || !from)
    throw new RuleError(
      "MISSING_MAIL_CONFIGURATION",
      "请配置 RESEND_API_KEY 和 EMAIL_FROM 后使用邮箱验证或找回密码。",
      503,
    );
  const endpoint = new URL(
    runtime.env.EMAIL_API_URL ?? "https://api.resend.com/emails",
  );
  const local = (value: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  if (
    endpoint.protocol !== "https:" &&
    !(
      endpoint.protocol === "http:" &&
      local(endpoint.href) &&
      runtime.env.APP_ORIGIN &&
      local(runtime.env.APP_ORIGIN)
    )
  )
    throw new RuleError(
      "INVALID_CONFIGURATION",
      "邮件 API 必须使用 HTTPS。",
      503,
    );
  return {
    async send(mail) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            "Idempotency-Key": mail.id,
          },
          body: JSON.stringify({
            from,
            to: [mail.to],
            subject:
              mail.purpose === "verify"
                ? "验证你的筑间邮箱"
                : "重置你的筑间密码",
            text: `${mail.purpose === "verify" ? "请点击链接验证邮箱，链接在 1 小时内有效。" : "请点击链接重置密码，链接在 30 分钟内有效。"}\n\n${mail.url}\n\n如果不是你本人操作，请忽略此邮件。`,
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new RuleError(
          "EMAIL_DELIVERY_FAILED",
          "邮件发送失败，请稍后重试。",
          503,
        );
      }
      if (!response.ok)
        throw new RuleError(
          "EMAIL_DELIVERY_FAILED",
          "邮件发送失败，请稍后重试。",
          503,
        );
    },
  };
}
