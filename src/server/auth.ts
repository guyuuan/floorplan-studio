import { SignJWT, jwtVerify } from "jose";
import { RuleError } from "../domain/engine";
import {
  authEnabled,
  configuredOrigin,
  getRuntime,
  type AppRuntime,
} from "./runtime";

const encoder = new TextEncoder();
export const SESSION_COOKIE = "floorplan_session";
const SESSION_SECONDS = 12 * 60 * 60;
type Session = { username: string; csrf: string };
export async function constantTimeEqual(a: string, b: string) {
  const [aa, bb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(aa),
    y = new Uint8Array(bb);
  let delta = 0;
  for (let i = 0; i < x.length; i++) delta |= x[i] ^ y[i];
  return delta === 0;
}
export function settings(runtime: AppRuntime) {
  const {
    APP_USERNAME: username,
    APP_PASSWORD: password,
    SESSION_SECRET: secret,
  } = runtime.env;
  if (
    !username ||
    !password ||
    password.length < 12 ||
    !secret ||
    secret.length < 32
  )
    throw new RuleError(
      "MISSING_AUTH_CONFIGURATION",
      "请配置 APP_USERNAME、至少 12 位的 APP_PASSWORD 和至少 32 位的 SESSION_SECRET。",
      503,
    );
  return { username, password, secret };
}
export function validateOrigin(request: Request, runtime: AppRuntime) {
  const allowed = configuredOrigin(runtime, request),
    origin = request.headers.get("origin");
  if (origin !== allowed)
    throw new RuleError(
      "ORIGIN_REJECTED",
      "请求来源无效，请从网站页面操作。",
      403,
    );
}
export async function issueSession(runtime: AppRuntime, request: Request) {
  const config = settings(runtime),
    origin = configuredOrigin(runtime, request),
    csrf = crypto.randomUUID();
  const token = await new SignJWT({
    username: config.username,
    csrf,
    role: "user",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(origin)
    .setAudience("floorplan-web")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(encoder.encode(config.secret));
  return { token, csrf };
}
export function sessionCookie(token: string, origin: string, clear = false) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${new URL(origin).protocol === "https:" ? "; Secure" : ""}`;
}
export async function requireUser(
  request: Request,
  runtime?: AppRuntime,
): Promise<Session | null> {
  const r = runtime ?? (await getRuntime());
  if (!authEnabled(r)) {
    configuredOrigin(r, request);
    return null;
  }
  const config = settings(r),
    origin = configuredOrigin(r, request);
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!cookie) throw new RuleError("LOGIN_REQUIRED", "请先登录。", 401);
  try {
    const { payload } = await jwtVerify(cookie, encoder.encode(config.secret), {
      algorithms: ["HS256"],
      issuer: origin,
      audience: "floorplan-web",
    });
    if (
      payload.role !== "user" ||
      payload.username !== config.username ||
      typeof payload.csrf !== "string"
    )
      throw new Error();
    return { username: config.username, csrf: payload.csrf };
  } catch {
    throw new RuleError("LOGIN_REQUIRED", "登录已过期，请重新登录。", 401);
  }
}
export async function requireUserMutation(request: Request) {
  const runtime = await getRuntime(),
    session = await requireUser(request, runtime);
  validateOrigin(request, runtime);
  if (
    session &&
    !(await constantTimeEqual(
      request.headers.get("x-floorplan-csrf") ?? "",
      session.csrf,
    ))
  )
    throw new RuleError(
      "CSRF_REJECTED",
      "登录验证已更新，请刷新页面重试。",
      403,
    );
}
export async function requireMcp(request: Request) {
  const runtime = await getRuntime();
  configuredOrigin(runtime, request);
  let expected = runtime.env.MCP_TOKEN ?? runtime.env.FLOORPLAN_MCP_TOKEN;
  if (!expected && runtime.mode === "local" && !authEnabled(runtime)) {
    expected = await (await import("./repositories/local")).localToken();
  }
  if (!expected || expected.length < 32)
    throw new RuleError(
      "MISSING_MCP_CONFIGURATION",
      "请配置至少 32 位的 MCP_TOKEN。",
      503,
    );
  const actual = request.headers.get("authorization") ?? "";
  if (!(await constantTimeEqual(actual, `Bearer ${expected}`)))
    throw new RuleError("UNAUTHORIZED", "MCP 访问令牌无效。", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== configuredOrigin(runtime, request))
    throw new RuleError("ORIGIN_REJECTED", "MCP 请求来源无效。", 403);
}

const localAttempts = new Map<string, { attempts: number; expires: number }>();
/** Increment before checking credentials so password guessing is bounded, including concurrent requests. */
export async function checkLoginRate(request: Request, runtime: AppRuntime) {
  const { secret } = settings(runtime),
    ip = request.headers.get("cf-connecting-ip") ?? "local";
  const key = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(`${secret}:${ip}`)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const now = Math.floor(Date.now() / 1000),
    expiry = now + 900;
  let attempts: number;
  if (runtime.mode === "cloudflare") {
    if (!runtime.env.DB)
      throw new RuleError("MISSING_BINDINGS", "缺少登录限流存储。", 503);
    const row = await runtime.env.DB.prepare(
      "INSERT INTO login_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at < ? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at < ? THEN ? ELSE expires_at END RETURNING attempts",
    )
      .bind(key, expiry, now, now, expiry)
      .first<{ attempts: number }>();
    attempts = row?.attempts ?? 11;
  } else {
    if (localAttempts.size > 2000)
      for (const [k, v] of localAttempts)
        if (v.expires < now) localAttempts.delete(k);
    const current = localAttempts.get(key),
      next =
        current && current.expires >= now
          ? { ...current, attempts: current.attempts + 1 }
          : { attempts: 1, expires: expiry };
    localAttempts.set(key, next);
    attempts = next.attempts;
  }
  if (attempts > 10)
    throw new RuleError(
      "RATE_LIMITED",
      "尝试次数过多，请在 15 分钟后重试。",
      429,
    );
}
