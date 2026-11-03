import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { RuleError } from "../domain/engine";
import { token } from "./store";

export function errorResponse(e: unknown) {
  if (e instanceof RuleError)
    return Response.json(
      { error: e.message, code: e.code },
      { status: e.status },
    );
  if (e instanceof ZodError)
    return Response.json(
      { error: "参数格式错误。", code: "VALIDATION_ERROR", details: e.issues },
      { status: 400 },
    );
  if (e instanceof SyntaxError)
    return Response.json(
      { error: "JSON 格式无效。", code: "INVALID_JSON" },
      { status: 400 },
    );
  console.error("Request failed:", e);
  return Response.json(
    { error: "操作失败，请稍后重试。", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}
export function requireBrowser(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin && origin !== "null" && new URL(origin).host === host) return;
  if (
    (!origin || origin === "null") &&
    request.headers.get("sec-fetch-site") === "same-origin"
  )
    return;
  throw new RuleError("ORIGIN_REJECTED", "此操作需要从项目网页发起。", 403);
}
export async function requireAgent(request: Request) {
  const actual = Buffer.from(request.headers.get("authorization") ?? ""),
    expected = Buffer.from(`Bearer ${await token()}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new RuleError("UNAUTHORIZED", "MCP 访问凭据无效。", 401);
}
export async function limitedJson(request: Request, max = 18 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) throw new RuleError("EMPTY_BODY", "请求内容为空。", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new RuleError("TOO_LARGE", "请求内容过大。", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
