import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { emptyPlan, type Project } from "../domain/schema";
import { applyCommands, RuleError, validatePlan } from "../domain/engine";
import { demoPlan } from "../domain/demo";
import { deriveRooms } from "../domain/geometry";

export const dataDirectory = path.resolve(
  process.env.FLOORPLAN_DATA_DIR ?? path.join(process.cwd(), ".data"),
);
const validId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new RuleError("INVALID_ID", "项目 ID 无效。", 400);
  return id;
};
const projectPath = (id: string) =>
  path.join(dataDirectory, `${validId(id)}.json`);
async function atomicWrite(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, file);
}
async function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dataDirectory, { recursive: true });
  const lock = path.join(dataDirectory, `${validId(id)}.lock`);
  let acquired = false;
  for (let i = 0; i < 100; i++) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  if (!acquired) throw new RuleError("BUSY", "项目正在保存，请稍后重试。", 503);
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export async function token() {
  if (process.env.FLOORPLAN_MCP_TOKEN) return process.env.FLOORPLAN_MCP_TOKEN;
  await mkdir(dataDirectory, { recursive: true });
  const file = path.join(dataDirectory, "mcp-token");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const t = randomBytes(32).toString("hex");
  try {
    await writeFile(file, t, { flag: "wx", mode: 0o600 });
    return t;
  } catch {
    return (await readFile(file, "utf8")).trim();
  }
}
export async function listProjects() {
  const { readdir } = await import("node:fs/promises");
  await mkdir(dataDirectory, { recursive: true });
  const files = (await readdir(dataDirectory)).filter((f) =>
    f.endsWith(".json"),
  );
  const all = await Promise.all(
    files.map((f) =>
      readFile(path.join(dataDirectory, f), "utf8").then(
        (s) => JSON.parse(s) as Project,
      ),
    ),
  );
  return all
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ id, name, updatedAt, stage, revision }) => ({
      id,
      name,
      updatedAt,
      stage,
      revision,
    }));
}
export async function getProject(id: string): Promise<Project> {
  try {
    return JSON.parse(await readFile(projectPath(id), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new RuleError("NOT_FOUND", "项目不存在。", 404);
    throw e;
  }
}
export async function createProject(
  name: string,
  source?: {
    data: Buffer;
    name: string;
    mime: NonNullable<Project["source"]>["mime"];
    width: number;
    height: number;
  },
  demo = false,
): Promise<Project> {
  const now = new Date().toISOString();
  const p: Project = {
    schemaVersion: 1,
    id: randomUUID(),
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
  if (demo) p.plan.walls.forEach((w) => (w.reviewed = true));
  validatePlan(p.plan);
  return locked(p.id, async () => {
    if (source)
      await writeFile(path.join(dataDirectory, `${p.id}.image`), source.data, {
        mode: 0o600,
      });
    await atomicWrite(projectPath(p.id), p);
    return p;
  });
}
export async function sourceImage(id: string) {
  const p = await getProject(id);
  if (!p.source) throw new RuleError("NO_IMAGE", "该项目没有上传原图。", 404);
  return {
    data: await readFile(path.join(dataDirectory, `${validId(id)}.image`)),
    meta: p.source,
  };
}
export async function mutateProject(
  id: string,
  revision: number,
  commands: unknown[],
  actor: "user" | "agent",
) {
  return locked(id, async () => {
    const p = await getProject(id);
    if (p.revision !== revision)
      throw new RuleError(
        "REVISION_CONFLICT",
        "项目已被更新，请刷新后重试。",
        409,
      );
    const next = applyCommands(p, commands, actor);
    await atomicWrite(projectPath(id), next);
    return next;
  });
}
export async function importProject(input: unknown) {
  const { z } = await import("zod");
  const { planSchema } = await import("../domain/schema");
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
  const image = bundle.image
    ? await inspectImage(
        Buffer.from(bundle.image.data, "base64"),
        bundle.image.name,
      )
    : undefined;
  const p = await createProject(`${bundle.name} · 导入`, image);
  p.plan = plan;
  p.calibrated = bundle.calibrated;
  await locked(p.id, () => atomicWrite(projectPath(p.id), p));
  return p;
}
export async function exportProject(id: string) {
  const p = await getProject(id);
  let image = null;
  if (p.source) {
    const s = await sourceImage(id);
    image = { ...s.meta, data: s.data.toString("base64") };
  }
  return {
    schemaVersion: 1,
    name: p.name,
    plan: p.plan,
    calibrated: p.calibrated,
    image,
  };
}
export async function inspectImage(data: Buffer, name: string) {
  if (data.length > 10 * 1024 * 1024)
    throw new RuleError("IMAGE_TOO_LARGE", "图片不能超过 10 MB。", 413);
  // Decode metadata using Next's bundled sharp dependency rather than trusting upload MIME headers.
  const sharp = (await import("sharp")).default;
  const meta = await sharp(data, { limitInputPixels: 40_000_000 })
    .metadata()
    .catch(() => {
      throw new RuleError(
        "INVALID_IMAGE",
        "请上传有效的 PNG、JPG 或 WebP 图片。",
        400,
      );
    });
  const mime = (
    { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const
  )[meta.format as "png" | "jpeg" | "webp"];
  if (!mime || !meta.width || !meta.height)
    throw new RuleError("INVALID_IMAGE", "仅支持 PNG、JPG、WebP 图片。", 400);
  return {
    data,
    name: name.slice(0, 150),
    mime,
    width: meta.width,
    height: meta.height,
  };
}
