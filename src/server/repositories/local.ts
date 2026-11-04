import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { Project } from "../../domain/schema";
import { RuleError } from "../../domain/engine";
import type { ProjectRepository } from "./types";
export const dataDirectory = path.resolve(
  process.env.FLOORPLAN_DATA_DIR ?? path.join(process.cwd(), ".data"),
);
const valid = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new RuleError("INVALID_ID", "项目 ID 无效。", 400);
  return id;
};
export async function localToken() {
  if (process.env.FLOORPLAN_MCP_TOKEN) return process.env.FLOORPLAN_MCP_TOKEN;
  await mkdir(dataDirectory, { recursive: true });
  const file = path.join(dataDirectory, "mcp-token");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const value = randomBytes(32).toString("hex");
  try {
    await writeFile(file, value, { flag: "wx", mode: 0o600 });
    return value;
  } catch {
    return (await readFile(file, "utf8")).trim();
  }
}
export class LocalRepository implements ProjectRepository {
  constructor(private directory = dataDirectory) {}
  private file(id: string) {
    return path.join(this.directory, `${valid(id)}.json`);
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter((f) =>
      f.endsWith(".json"),
    );
    const all = await Promise.all(
      files.map((f) =>
        readFile(path.join(this.directory, f), "utf8").then(
          (s) => JSON.parse(s) as Project,
        ),
      ),
    );
    return all
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, name, stage, revision, updatedAt }) => ({
        id,
        name,
        stage,
        revision,
        updatedAt,
      }));
  }
  async get(id: string): Promise<Project> {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new RuleError("NOT_FOUND", "项目不存在。", 404);
      throw e;
    }
  }
  async revision(id: string) {
    return (await this.get(id)).revision;
  }
  async save(project: Project, expectedRevision: number | null) {
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, `${valid(project.id)}.lock`);
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
    if (!acquired)
      throw new RuleError("BUSY", "项目正在保存，请稍后重试。", 503);
    try {
      let existing: Project | null = null;
      try {
        existing = await this.get(project.id);
      } catch (e) {
        if (!(e instanceof RuleError && e.status === 404)) throw e;
      }
      if (
        expectedRevision === null
          ? existing !== null
          : existing?.revision !== expectedRevision
      )
        throw new RuleError(
          "REVISION_CONFLICT",
          "项目已被更新，请刷新后重试。",
          409,
        );
      const temp = `${this.file(project.id)}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(project), { mode: 0o600 });
      await rename(temp, this.file(project.id));
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  private binaryPath(id: string, kind: "source" | "png") {
    return path.join(
      this.directory,
      `${valid(id)}.${kind === "source" ? "image" : "export.png"}`,
    );
  }
  async putBinary(id: string, kind: "source" | "png", data: Uint8Array) {
    await mkdir(this.directory, { recursive: true });
    const file = this.binaryPath(id, kind),
      temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, file);
  }
  async getBinary(id: string, kind: "source" | "png") {
    try {
      return new Uint8Array(await readFile(this.binaryPath(id, kind)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new RuleError("NOT_FOUND", "图片不存在。", 404);
      throw e;
    }
  }
}
