import type { AppRuntime } from "../runtime";
import type { User } from "./accounts";
export async function claimLegacyProjects(runtime: AppRuntime, user: User) {
  if (!user.legacyOwner) return;
  if (runtime.mode === "cloudflare") {
    await runtime.env
      .DB!.prepare(
        "UPDATE projects SET owner_id=?,legacy_files=1 WHERE owner_id IS NULL",
      )
      .bind(user.id)
      .run();
    return;
  }
  const { importLegacyProjects } = await import("./local-legacy-projects");
  await importLegacyProjects(user.id);
}
