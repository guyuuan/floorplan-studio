import { ZodError } from "zod";
import { RuleError } from "../domain/engine";
import { requireMcp, requireUserMutation } from "./auth";

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
export const requireBrowser = requireUserMutation;
export const requireAgent = requireMcp;
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
