import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { Project, Snapshot } from "../../domain/schema";
import { RuleError } from "../../domain/engine";
import type { ProjectRepository, ProjectSummary } from "./types";

type Row = {
  id: string;
  name: string;
  stage: Project["stage"];
  revision: number;
  state_key: string;
  created_at: string;
  updated_at: string;
  legacy_files: number;
};
type StoredProject = Omit<Project, "history" | "future"> & {
  historyKeys: string[];
  futureKeys: string[];
};
const valid = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new RuleError("INVALID_ID", "项目 ID 无效。", 400);
  return id;
};
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** R2 objects are immutable; a single D1 CAS update publishes a complete project state. */
export class CloudflareRepository implements ProjectRepository {
  private knownSnapshots = new Map<string, string>();
  constructor(
    private db: D1Database,
    private files: R2Bucket,
    private ownerId: string,
  ) {}
  private async row(id: string) {
    const row = await this.db
      .prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?")
      .bind(valid(id), this.ownerId)
      .first<Row>();
    if (!row) throw new RuleError("NOT_FOUND", "项目不存在。", 404);
    return row;
  }
  async list(): Promise<ProjectSummary[]> {
    const { results } = await this.db
      .prepare(
        "SELECT id,name,stage,revision,updated_at FROM projects WHERE owner_id=? ORDER BY updated_at DESC",
      )
      .bind(this.ownerId)
      .all<Row>();
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      stage: r.stage,
      revision: r.revision,
      updatedAt: r.updated_at,
    }));
  }
  async revision(id: string) {
    return (await this.row(id)).revision;
  }
  private async readJson<T>(key: string) {
    const object = await this.files.get(key);
    if (!object)
      throw new RuleError(
        "MISSING_OBJECT",
        "项目数据暂不可用，请稍后重试。",
        503,
      );
    return object.json<T>();
  }
  async get(id: string): Promise<Project> {
    const row = await this.row(id),
      stored = await this.readJson<StoredProject>(row.state_key);
    const load = async (key: string) => {
      const snapshot = await this.readJson<Snapshot>(key);
      this.knownSnapshots.set(
        `${id}:${await digest(JSON.stringify(snapshot))}`,
        key,
      );
      return snapshot;
    };
    const { historyKeys, futureKeys, ...core } = stored;
    const [history, future] = await Promise.all([
      Promise.all(historyKeys.map(load)),
      Promise.all(futureKeys.map(load)),
    ]);
    if (core.id !== id || core.revision !== row.revision)
      throw new RuleError("CORRUPT_STATE", "项目版本索引不一致。", 503);
    return { ...core, history, future };
  }
  async save(project: Project, expectedRevision: number | null) {
    valid(project.id);
    const saveSnapshot = async (snapshot: Snapshot) => {
      const text = JSON.stringify(snapshot),
        hash = await digest(text),
        known = this.knownSnapshots.get(`${project.id}:${hash}`);
      if (known) return known;
      const key = `snapshots/${this.ownerId}/${project.id}/${hash}.json`;
      await this.files.put(key, text, {
        httpMetadata: { contentType: "application/json" },
      });
      this.knownSnapshots.set(`${project.id}:${hash}`, key);
      return key;
    };
    const { history, future, ...core } = project;
    const [historyKeys, futureKeys] = await Promise.all([
      Promise.all(history.map(saveSnapshot)),
      Promise.all(future.map(saveSnapshot)),
    ]);
    const key = `states/${this.ownerId}/${project.id}/${project.revision}-${crypto.randomUUID()}.json`;
    await this.files.put(
      key,
      JSON.stringify({
        ...core,
        historyKeys,
        futureKeys,
      } satisfies StoredProject),
      { httpMetadata: { contentType: "application/json" } },
    );
    try {
      let changes: number;
      if (expectedRevision === null) {
        const result = await this.db
          .prepare(
            "INSERT INTO projects(id,name,stage,revision,state_key,created_at,updated_at,owner_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(
            project.id,
            project.name,
            project.stage,
            project.revision,
            key,
            project.createdAt,
            project.updatedAt,
            this.ownerId,
          )
          .run();
        changes = result.meta.changes;
      } else {
        const result = await this.db
          .prepare(
            "UPDATE projects SET name=?,stage=?,revision=?,state_key=?,updated_at=? WHERE id=? AND revision=? AND owner_id=?",
          )
          .bind(
            project.name,
            project.stage,
            project.revision,
            key,
            project.updatedAt,
            project.id,
            expectedRevision,
            this.ownerId,
          )
          .run();
        changes = result.meta.changes;
      }
      if (changes !== 1) {
        await this.files.delete(key);
        throw new RuleError(
          "REVISION_CONFLICT",
          "项目已被更新，请刷新后重试。",
          409,
        );
      }
    } catch (e) {
      // Never delete content-addressed snapshots: another winning request can reference them.
      // An uncertain D1 outcome leaves the immutable state in R2 for safe recovery.
      throw e;
    }
  }
  private binaryKey(id: string, kind: "source" | "png") {
    return `files/${this.ownerId}/${valid(id)}/${kind}`;
  }
  async putBinary(
    id: string,
    kind: "source" | "png",
    data: Uint8Array,
    mime: string,
  ) {
    const object = await this.files.put(this.binaryKey(id, kind), data, {
      httpMetadata: { contentType: mime, cacheControl: "private, no-store" },
      ...(kind === "source" ? { onlyIf: { etagDoesNotMatch: "*" } } : {}),
    });
    if (!object) {
      const existing = await this.files.get(this.binaryKey(id, kind));
      if (
        existing &&
        Buffer.compare(
          Buffer.from(await existing.arrayBuffer()),
          Buffer.from(data),
        ) === 0
      )
        return;
      throw new RuleError(
        "ALREADY_EXISTS",
        "该项目的原图已经存在，不允许覆盖。",
        409,
      );
    }
  }
  async getBinary(id: string, kind: "source" | "png") {
    const row = await this.row(id);
    const object =
      (await this.files.get(this.binaryKey(id, kind))) ??
      (row.legacy_files
        ? await this.files.get(`files/${valid(id)}/${kind}`)
        : null);
    if (!object) throw new RuleError("NOT_FOUND", "图片不存在。", 404);
    return new Uint8Array(await object.arrayBuffer());
  }
}
