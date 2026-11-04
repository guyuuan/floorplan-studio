import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { CloudflareRepository } from "../src/server/repositories/cloudflare";
import { ProjectService, inspectImage } from "../src/server/store";
import { applyCommands, RuleError } from "../src/domain/engine";
import { migrateProject } from "../src/server/migration";

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-11-03",
    d1Databases: { DB: "test-floorplan" },
    r2Buckets: ["FILES"],
  }),
);
const db = (await mf.getD1Database("DB")) as unknown as D1Database,
  files = (await mf.getR2Bucket("FILES")) as unknown as R2Bucket;
await db.exec(
  (await readFile("migrations/0001_cloud_storage.sql", "utf8")).replace(
    /\n/g,
    " ",
  ),
);
const repository = () => new CloudflareRepository(db, files),
  service = () => new ProjectService(repository());
after(() => mf.dispose());

test("real D1/R2: project, original image, PNG and JSON persist across service instances", async () => {
  const bytes = new Uint8Array(await readFile("examples/sample-floorplan.png")),
    source = await inspectImage(bytes, "floorplan.png");
  const p = await service().createProject("cloud roundtrip", source, true);
  const restored = await service().getProject(p.id);
  assert.equal(restored.name, p.name);
  assert.deepEqual(restored.plan, p.plan);
  assert.deepEqual((await service().sourceImage(p.id)).data, bytes);
  await service().savePng(p.id, bytes);
  assert.deepEqual(await service().getPng(p.id), bytes);
  const exported = await service().exportProject(p.id);
  assert.equal(exported.image!.width, 1400);
  const imported = await service().importProject(exported);
  assert.equal(imported.stage, "reconstruction");
  assert.ok(imported.plan.walls.every((w) => !w.reviewed));
});
test("real D1 CAS: simultaneous edits publish exactly one complete state", async () => {
  const p = await service().createProject("concurrent", undefined, true),
    roomId = p.plan.rooms[0].id;
  const results = await Promise.allSettled(
    ["first", "second"].map((name) =>
      service().mutateProject(
        p.id,
        0,
        [{ type: "update_room", roomId, name }],
        "agent",
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "REVISION_CONFLICT");
  const next = await service().getProject(p.id);
  assert.equal(next.revision, 1);
  assert.equal(next.history.length, 1);
});
test("cloud snapshots retain undo/redo and remain outside the D1 row", async () => {
  let p = await service().createProject("undo", undefined, true);
  const roomId = p.plan.rooms[0].id,
    oldName = p.plan.rooms[0].name;
  p = await service().mutateProject(
    p.id,
    p.revision,
    [{ type: "update_room", roomId, name: "new room" }],
    "user",
  );
  p = await service().mutateProject(
    p.id,
    p.revision,
    [{ type: "undo" }],
    "user",
  );
  assert.equal(p.plan.rooms.find((r) => r.id === roomId)!.name, oldName);
  p = await service().mutateProject(
    p.id,
    p.revision,
    [{ type: "redo" }],
    "user",
  );
  assert.equal(p.plan.rooms.find((r) => r.id === roomId)!.name, "new room");
  const row = await db
    .prepare("SELECT state_key FROM projects WHERE id=?")
    .bind(p.id)
    .first<{ state_key: string }>();
  const state = await (await files.get(row!.state_key))!.json<{
    historyKeys: string[];
    history?: unknown;
  }>();
  assert.equal(state.history, undefined);
  assert.ok(state.historyKeys.length > 0);
});
test("a failed atomic design batch leaves the D1 pointer and project untouched", async () => {
  const p = await service().createProject("rules", undefined, true);
  await assert.rejects(
    service().mutateProject(
      p.id,
      0,
      [
        {
          type: "update_room",
          roomId: p.plan.rooms[0].id,
          name: "should not save",
        },
        { type: "remove_wall", wallId: "ext_n" },
      ],
      "agent",
    ),
    (e) => e instanceof RuleError && e.code === "EXTERIOR_LOCKED",
  );
  assert.deepEqual(await service().getProject(p.id), p);
});
test("owner migration preserves ID, revision and history and never overwrites an existing project", async () => {
  const fixture = await service().createProject(
    "migration original",
    undefined,
    true,
  );
  const moved = structuredClone(fixture);
  moved.id = crypto.randomUUID();
  moved.revision = 7;
  moved.history = [
    { plan: structuredClone(moved.plan), stage: moved.stage, calibrated: true },
  ];
  await migrateProject(service(), { project: moved });
  assert.deepEqual(await service().getProject(moved.id), moved);
  await assert.rejects(
    migrateProject(service(), { project: { ...moved, name: "overwrite" } }),
    (e) => e instanceof RuleError && e.code === "ALREADY_EXISTS",
  );
  assert.equal((await service().getProject(moved.id)).name, moved.name);
});
test("R2 source uploads are immutable and an identical retry is safe", async () => {
  const id = crypto.randomUUID(),
    repo = repository();
  await repo.putBinary(id, "source", new Uint8Array([1, 2, 3]), "image/png");
  await repo.putBinary(id, "source", new Uint8Array([1, 2, 3]), "image/png");
  await assert.rejects(
    repo.putBinary(id, "source", new Uint8Array([4, 5]), "image/png"),
    (e) => e instanceof RuleError && e.code === "ALREADY_EXISTS",
  );
  assert.deepEqual(
    await repo.getBinary(id, "source"),
    new Uint8Array([1, 2, 3]),
  );
});
