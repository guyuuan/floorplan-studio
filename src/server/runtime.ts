import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { RuleError } from "../domain/engine";

export type AppEnv = {
  DB?: D1Database;
  FILES?: R2Bucket;
  FLOORPLAN_STORAGE?: string;
  APP_ORIGIN?: string;
  APP_USERNAME?: string;
  APP_PASSWORD?: string;
  APP_OWNER_EMAIL?: string;
  REGISTRATION_ENABLED?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_API_URL?: string;
  SESSION_SECRET?: string;
  MCP_TOKEN?: string;
  FLOORPLAN_MCP_TOKEN?: string;
};
export type AppRuntime = { mode: "local" | "cloudflare"; env: AppEnv };
export async function getRuntime(): Promise<AppRuntime> {
  try {
    const { env } = getCloudflareContext();
    return { mode: "cloudflare", env: env as AppEnv };
  } catch {
    if (process.env.FLOORPLAN_STORAGE === "cloudflare")
      throw new RuleError(
        "CLOUDFLARE_BINDINGS_REQUIRED",
        "请使用 Workers 预览或部署命令启动云端存储。",
        503,
      );
    return { mode: "local", env: process.env as AppEnv };
  }
}
export function authEnabled(runtime: AppRuntime) {
  return (
    runtime.mode === "cloudflare" ||
    !!(
      runtime.env.APP_USERNAME ||
      runtime.env.APP_PASSWORD ||
      runtime.env.SESSION_SECRET
    )
  );
}
export function configuredOrigin(runtime: AppRuntime, request?: Request) {
  const configured = runtime.env.APP_ORIGIN;
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        throw new Error();
      if (
        runtime.mode === "cloudflare" &&
        url.protocol !== "https:" &&
        url.hostname !== "localhost" &&
        url.hostname !== "127.0.0.1"
      )
        throw new Error();
      return url.origin;
    } catch {
      throw new RuleError(
        "INVALID_CONFIGURATION",
        "APP_ORIGIN 必须为完整的网站来源地址，不包含路径。",
        503,
      );
    }
  }
  if (runtime.mode === "cloudflare")
    throw new RuleError("MISSING_CONFIGURATION", "请配置 APP_ORIGIN。", 503);
  if (!request)
    throw new RuleError("MISSING_CONFIGURATION", "请配置 APP_ORIGIN。", 503);
  const url = new URL(request.url),
    host = request.headers.get("host") ?? url.host;
  const origin = new URL(`${url.protocol}//${host}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    throw new RuleError("LOCAL_ONLY", "本地免登录模式仅允许回环地址。", 403);
  return origin.origin;
}
