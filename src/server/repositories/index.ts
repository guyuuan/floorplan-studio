import { getRuntime } from "../runtime";
import { RuleError } from "../../domain/engine";
import type { ProjectRepository } from "./types";
export async function getRepository(): Promise<ProjectRepository> {
  const runtime = await getRuntime();
  if (runtime.mode === "cloudflare") {
    if (!runtime.env.DB || !runtime.env.FILES)
      throw new RuleError(
        "MISSING_BINDINGS",
        "请配置 D1 DB 和私有 R2 FILES 绑定。",
        503,
      );
    const { CloudflareRepository } = await import("./cloudflare");
    return new CloudflareRepository(runtime.env.DB, runtime.env.FILES);
  }
  const { LocalRepository } = await import("./local");
  return new LocalRepository();
}
