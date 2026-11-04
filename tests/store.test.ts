import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { RuleError } from "../src/domain/engine";
const directory = await mkdtemp(path.join(os.tmpdir(), "floorplan-test-"));
process.env.FLOORPLAN_DATA_DIR = directory;
const store = await import("../src/server/store");
after(async () => {
  await rm(directory, { recursive: true, force: true });
});
test("optimistic revision prevents concurrent updates from overwriting each other", async () => {
  const p = await store.createProject("concurrency", undefined, true);
  const room = p.plan.rooms[0];
  const results = await Promise.allSettled([
    store.mutateProject(
      p.id,
      0,
      [{ type: "update_room", roomId: room.id, name: "first" }],
      "agent",
    ),
    store.mutateProject(
      p.id,
      0,
      [{ type: "update_room", roomId: room.id, name: "second" }],
      "agent",
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "REVISION_CONFLICT");
  assert.equal((await store.getProject(p.id)).revision, 1);
});
test("export/import preserves complete geometry and original image, and re-enters user review", async () => {
  const image = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const source = await store.inspectImage(image, "test.png");
  const p = await store.createProject("roundtrip", source, true),
    bundle = await store.exportProject(p.id),
    imported = await store.importProject(bundle);
  assert.notEqual(imported.id, p.id);
  assert.deepEqual(
    imported.plan.walls.map((w) => ({ ...w, reviewed: true })),
    p.plan.walls,
  );
  assert.equal(imported.stage, "reconstruction");
  assert.ok(imported.plan.walls.every((w) => !w.reviewed));
  assert.equal(imported.plan.furniture.length, p.plan.furniture.length);
  assert.deepEqual(
    Buffer.from((await store.sourceImage(imported.id)).data),
    image,
  );
});
test("invalid and oversized images are rejected", async () => {
  await assert.rejects(
    store.inspectImage(Buffer.from("invalid"), "bad.png"),
    (e) => e instanceof RuleError && e.code === "INVALID_IMAGE",
  );
  await assert.rejects(
    store.inspectImage(Buffer.alloc(10 * 1024 * 1024 + 1), "big.png"),
    (e) => e instanceof RuleError && e.code === "IMAGE_TOO_LARGE",
  );
});
test("project paths are constrained and missing projects report 404", async () => {
  await assert.rejects(
    store.getProject("../escape"),
    (e) => e instanceof RuleError && e.code === "INVALID_ID",
  );
  await assert.rejects(
    store.getProject("missing"),
    (e) => e instanceof RuleError && e.status === 404,
  );
});
