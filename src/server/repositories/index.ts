import path from "node:path";
import { authEnabled, getRuntime } from "../runtime";
import { RuleError } from "../../domain/engine";
import type { ProjectRepository } from "./types";
export async function getRepository(
  ownerId?: string | null,
): Promise<ProjectRepository> {
  const runtime = await getRuntime();
  if (authEnabled(runtime) && !ownerId)
    throw new RuleError("LOGIN_REQUIRED", "用户身份缺失。", 401);
  if (ownerId && !/^[a-zA-Z0-9-]{1,100}$/.test(ownerId))
    throw new RuleError("INVALID_ID", "用户 ID 无效。", 400);
  if (runtime.mode === "cloudflare") {
    if (!runtime.env.DB || !runtime.env.FILES)
      throw new RuleError(
        "MISSING_BINDINGS",
        "请配置 D1 DB 和私有 R2 FILES 绑定。",
        503,
      );
    const { CloudflareRepository } = await import("./cloudflare");
    return new CloudflareRepository(
      runtime.env.DB,
      runtime.env.FILES,
      ownerId!,
    );
  }
  const { LocalRepository, dataDirectory } = await import("./local");
  return new LocalRepository(
    ownerId
      ? path.join(dataDirectory, "users", ownerId, "projects")
      : dataDirectory,
  );
}
