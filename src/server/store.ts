import { z } from "zod";
import { imageSize } from "image-size";
import { emptyPlan, planSchema, type Project } from "../domain/schema";
import { applyCommands, RuleError, validatePlan } from "../domain/engine";
import { demoPlan } from "../domain/demo";
import { deriveRooms } from "../domain/geometry";
import { getRepository } from "./repositories";
import type { ProjectRepository } from "./repositories/types";

export type UploadedImage = {
  data: Uint8Array;
  name: string;
  mime: NonNullable<Project["source"]>["mime"];
  width: number;
  height: number;
};
export async function inspectImage(
  data: Uint8Array,
  name: string,
): Promise<UploadedImage> {
  if (data.byteLength > 10 * 1024 * 1024)
    throw new RuleError("IMAGE_TOO_LARGE", "图片不能超过 10 MB。", 413);
  let info: ReturnType<typeof imageSize>;
  try {
    info = imageSize(data);
  } catch {
    throw new RuleError(
      "INVALID_IMAGE",
      "请上传有效的 PNG、JPG 或 WebP 图片。",
      400,
    );
  }
  const mime = (
    { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const
  )[info.type as "png" | "jpg" | "webp"];
  if (
    !mime ||
    !info.width ||
    !info.height ||
    info.width * info.height > 40_000_000
  )
    throw new RuleError(
      "INVALID_IMAGE",
      "仅支持不超过 4000 万像素的 PNG、JPG、WebP 图片。",
      400,
    );
  return {
    data,
    name: name.slice(0, 150),
    mime,
    width: info.width,
    height: info.height,
  };
}
export class ProjectService {
  constructor(public repository: ProjectRepository) {}
  listProjects() {
    return this.repository.list();
  }
  getProject(id: string) {
    return this.repository.get(id);
  }
  revision(id: string) {
    return this.repository.revision(id);
  }
  async createProject(name: string, source?: UploadedImage, demo = false) {
    const now = new Date().toISOString();
    const project: Project = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      name: name.slice(0, 80) || "未命名项目",
      createdAt: now,
      updatedAt: now,
      revision: 0,
      stage: demo ? "design" : "reconstruction",
      calibrated: demo,
      source: source
        ? {
            name: source.name,
            mime: source.mime,
            width: source.width,
            height: source.height,
          }
        : null,
      plan: demo ? demoPlan() : emptyPlan(),
      history: [],
      future: [],
      activity: [],
    };
    if (demo) project.plan.walls.forEach((w) => (w.reviewed = true));
    validatePlan(project.plan);
    if (source)
      await this.repository.putBinary(
        project.id,
        "source",
        source.data,
        source.mime,
      );
    await this.repository.save(project, null);
    return project;
  }
  async sourceImage(id: string) {
    const p = await this.getProject(id);
    if (!p.source) throw new RuleError("NO_IMAGE", "该项目没有上传原图。", 404);
    return {
      data: await this.repository.getBinary(id, "source"),
      meta: p.source,
    };
  }
  async mutateProject(
    id: string,
    revision: number,
    commands: unknown[],
    actor: "user" | "agent",
  ) {
    const p = await this.getProject(id);
    if (p.revision !== revision)
      throw new RuleError(
        "REVISION_CONFLICT",
        "项目已被更新，请刷新后重试。",
        409,
      );
    const next = applyCommands(p, commands, actor);
    await this.repository.save(next, revision);
    return next;
  }
  async importProject(input: unknown) {
    const bundle = z
      .object({
        schemaVersion: z.literal(1),
        name: z.string().max(80),
        plan: planSchema,
        calibrated: z.boolean().default(false),
        image: z
          .object({
            data: z.string().max(16000000),
            name: z.string(),
            mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
            width: z.number().positive(),
            height: z.number().positive(),
          })
          .nullable()
          .optional(),
      })
      .parse(input);
    const plan = validatePlan(bundle.plan);
    plan.walls.forEach((w) => (w.reviewed = false));
    plan.rooms = deriveRooms(plan);
    const source = bundle.image
      ? await inspectImage(
          Buffer.from(bundle.image.data, "base64"),
          bundle.image.name,
        )
      : undefined;
    const project = await this.createProject(`${bundle.name} · 导入`, source);
    project.plan = plan;
    project.calibrated = bundle.calibrated;
    await this.repository.save(project, 0);
    return project;
  }
  async exportProject(id: string) {
    const p = await this.getProject(id);
    let image = null;
    if (p.source) {
      const data = await this.repository.getBinary(id, "source");
      image = { ...p.source, data: Buffer.from(data).toString("base64") };
    }
    return {
      schemaVersion: 1,
      name: p.name,
      plan: p.plan,
      calibrated: p.calibrated,
      image,
    };
  }
  async savePng(id: string, data: Uint8Array) {
    await this.revision(id);
    const image = await inspectImage(data, "export.png");
    if (image.mime !== "image/png")
      throw new RuleError("INVALID_IMAGE", "仅接受 PNG 导出内容。", 400);
    await this.repository.putBinary(id, "png", data, "image/png");
  }
  async getPng(id: string) {
    await this.revision(id);
    return this.repository.getBinary(id, "png");
  }
}
export async function getProjectService(ownerId?: string | null) {
  return new ProjectService(await getRepository(ownerId));
}
export const listProjects = async () =>
  (await getProjectService()).listProjects();
export const getProject = async (id: string) =>
  (await getProjectService()).getProject(id);
export const sourceImage = async (id: string) =>
  (await getProjectService()).sourceImage(id);
export const createProject = async (
  name: string,
  source?: UploadedImage,
  demo = false,
) => (await getProjectService()).createProject(name, source, demo);
export const mutateProject = async (
  id: string,
  revision: number,
  commands: unknown[],
  actor: "user" | "agent",
) => (await getProjectService()).mutateProject(id, revision, commands, actor);
export const importProject = async (input: unknown) =>
  (await getProjectService()).importProject(input);
export const exportProject = async (id: string) =>
  (await getProjectService()).exportProject(id);
