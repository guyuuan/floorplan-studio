import { z } from "zod";
import { planSchema, furnitureSchema, type Project } from "../domain/schema";
import { RuleError, validatePlan } from "../domain/engine";
import { inspectImage, type ProjectService } from "./store";
const snapshot = z.object({
  plan: planSchema.extend({
    furniture: z.array(furnitureSchema.passthrough()),
  }),
  stage: z.enum(["reconstruction", "design"]),
  calibrated: z.boolean(),
});
const source = z.object({
  name: z.string().max(150),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const migrationSchema = z.object({
  project: snapshot.extend({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    name: z.string().max(80),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().max(60),
    updatedAt: z.string().max(60),
    source: source.nullable(),
    history: z.array(snapshot).max(40),
    future: z.array(snapshot).max(40),
    activity: z
      .array(
        z.object({
          at: z.string().max(60),
          actor: z.enum(["user", "agent"]),
          text: z.string().max(500),
        }),
      )
      .max(100),
  }),
  imageBase64: z.string().max(14000000).optional(),
});
/** Authenticated owner-only migration. Existing IDs are never overwritten. */
export async function migrateProject(service: ProjectService, input: unknown) {
  const { project, imageBase64 } = migrationSchema.parse(input);
  if (project.history.length + project.future.length > 40)
    throw new RuleError(
      "TOO_MUCH_HISTORY",
      "迁移项目的历史版本总数不能超过 40。",
      400,
    );
  validatePlan(project.plan);
  for (const s of [...project.history, ...project.future]) validatePlan(s.plan);
  let exists = false;
  try {
    await service.repository.revision(project.id);
    exists = true;
  } catch (e) {
    if (!(e instanceof RuleError && e.status === 404)) throw e;
  }
  if (exists)
    throw new RuleError(
      "ALREADY_EXISTS",
      "该项目 ID 已存在；迁移不会覆盖已有项目。",
      409,
    );
  if (project.source) {
    if (!imageBase64)
      throw new RuleError("MISSING_SOURCE", "该项目需要同时迁移原图。", 400);
    const image = await inspectImage(
      Buffer.from(imageBase64, "base64"),
      project.source.name,
    );
    if (
      image.mime !== project.source.mime ||
      image.width !== project.source.width ||
      image.height !== project.source.height
    )
      throw new RuleError("SOURCE_MISMATCH", "原图与项目元数据不一致。", 400);
    await service.repository.putBinary(
      project.id,
      "source",
      image.data,
      image.mime,
    );
  } else if (imageBase64)
    throw new RuleError("SOURCE_MISMATCH", "项目没有原图元数据。", 400);
  await service.repository.save(project as Project, null);
  return { id: project.id, name: project.name, revision: project.revision };
}
