import test from "node:test";
import assert from "node:assert/strict";
import polygonClipping from "polygon-clipping";
import { applyCommands, RuleError } from "../src/domain/engine";
import {
  along,
  area,
  wallFootprints,
  wallLength,
} from "../src/domain/geometry";
import {
  wallFaceAttachments,
  wallFaceAttachmentFits,
} from "../src/domain/wall-joints";
import type { Point, Project, Wall } from "../src/domain/schema";
const wall = (id: string, a: Point, b: Point, thickness = 120): Wall => ({
  id,
  a,
  b,
  thickness,
  height: 2800,
  kind: "partition",
  reviewed: true,
});
function fixture(branch = wall("branch", [3120, 3000], [5000, 3000])): Project {
  return {
    schemaVersion: 1,
    id: "joints",
    name: "joints",
    revision: 0,
    createdAt: "",
    updatedAt: "",
    source: null,
    calibrated: true,
    stage: "design",
    history: [],
    future: [],
    activity: [],
    plan: {
      units: "mm",
      boundary: [
        [0, 0],
        [6000, 0],
        [6000, 6000],
        [0, 6000],
      ],
      walls: [wall("host", [3000, 1000], [3000, 5000], 240), branch],
      openings: [],
      rooms: [],
      furniture: [],
    },
  };
}
const byId = (p: Project, id: string) => p.plan.walls.find((w) => w.id === id)!;
const resize = (
  p: Project,
  thickness: number,
  actor: "user" | "agent" = "user",
) =>
  applyCommands(p, [{ type: "update_wall", wallId: "host", thickness }], actor);
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
function assertNoOverlap(p: Project) {
  const footprints = wallFootprints(p.plan.walls);
  for (let i = 0; i < p.plan.walls.length; i++)
    for (let j = i + 1; j < p.plan.walls.length; j++) {
      const overlap = polygonClipping.intersection(
        footprints[p.plan.walls[i].id],
        footprints[p.plan.walls[j].id],
      );
      near(
        overlap.reduce((sum, polygon) => sum + area(polygon[0] as Point[]), 0),
        0,
      );
    }
}
function rejected(p: Project, thickness: number, code: string) {
  const before = structuredClone(p);
  assert.throws(
    () => resize(p, thickness),
    (e) => e instanceof RuleError && e.code === code,
  );
  assert.deepEqual(p, before);
}

test("the reported 240→320→160 case follows both growing and shrinking faces and keeps the opposite end fixed", () => {
  const original = fixture(),
    enlarged = resize(original, 320);
  assert.deepEqual(byId(enlarged, "host").a, [3000, 1000]);
  assert.deepEqual(byId(enlarged, "host").b, [3000, 5000]);
  assert.deepEqual(byId(enlarged, "branch").a, [3160, 3000]);
  assert.deepEqual(byId(enlarged, "branch").b, [5000, 3000]);
  const shrunk = resize(enlarged, 160);
  assert.deepEqual(byId(shrunk, "branch").a, [3080, 3000]);
  assert.deepEqual(byId(shrunk, "branch").b, [5000, 3000]);
  assertNoOverlap(enlarged);
  assertNoOverlap(shrunk);
});
test("branches on both faces, including a reversed branch, follow without moving their free ends", () => {
  const original = fixture();
  original.plan.walls.push(wall("left", [1000, 3000], [2880, 3000]));
  const next = resize(original, 400, "agent");
  assert.deepEqual(byId(next, "branch").a, [3200, 3000]);
  assert.deepEqual(byId(next, "left").b, [2800, 3000]);
  assert.deepEqual(byId(next, "left").a, [1000, 3000]);
  assert.deepEqual(byId(next, "branch").b, [5000, 3000]);
  assertNoOverlap(next);
});
test("horizontal and reversed hosts follow their local normals rather than a hard-coded X coordinate", () => {
  for (const reverse of [false, true]) {
    const original = fixture(wall("branch", [3000, 3120], [3000, 5000]));
    const host = byId(original, "host");
    host.a = reverse ? [5000, 3000] : [1000, 3000];
    host.b = reverse ? [1000, 3000] : [5000, 3000];
    const next = resize(original, 320);
    assert.deepEqual(byId(next, "branch").a, [3000, 3160]);
    assert.deepEqual(byId(next, "branch").b, [3000, 5000]);
    assertNoOverlap(next);
  }
});
test("oblique branches intersect the new face along their own axes and preserve opening world coordinates", () => {
  for (const reverse of [false, true]) {
    const original = fixture(
      wall(
        "branch",
        reverse ? [5000, 4500] : [3120, 3000],
        reverse ? [3120, 3000] : [5000, 4500],
      ),
    );
    original.plan.openings.push({
      id: "door",
      wallId: "branch",
      kind: "door",
      offset: 500,
      width: 800,
      height: 2100,
      sill: 0,
      swing: "left",
    });
    const before = along(byId(original, "branch"), 500),
      next = resize(original, 320),
      changed = byId(next, "branch");
    const end = reverse ? changed.b : changed.a;
    near(end[0], 3160);
    near(end[1], 3000 + (40 * 1500) / 1880);
    assert.deepEqual(reverse ? changed.a : changed.b, [5000, 4500]);
    const after = along(changed, next.plan.openings[0].offset);
    near(after[0], before[0]);
    near(after[1], before[1]);
    assertNoOverlap(next);
  }
});
test("both endpoint-anchored neighbours and their door/window world positions survive a thickness change", () => {
  const original = fixture();
  original.plan.walls.push({
    ...wall("far_host", [5120, 1000], [5120, 5000], 240),
    kind: "bearing",
  });
  original.plan.openings.push({
    id: "window",
    wallId: "branch",
    kind: "window",
    offset: 500,
    width: 800,
    height: 1200,
    sill: 900,
    swing: "left",
  });
  const next = resize(original, 160);
  assert.deepEqual(byId(next, "branch").a, [3080, 3000]);
  assert.deepEqual(byId(next, "branch").b, [5000, 3000]);
  near(next.plan.openings[0].offset, 540);
  assert.deepEqual(along(byId(next, "branch"), 540), [3620, 3000]);
  assert.deepEqual(byId(next, "far_host"), byId(original, "far_host"));
  assertNoOverlap(next);
});
test("face anchors are inferred only for actual outward contacts, not nearby gaps or legacy centerline nodes", () => {
  const original = fixture(wall("branch", [3160, 3000], [5000, 3000]));
  assert.deepEqual(
    wallFaceAttachments(byId(original, "host"), original.plan.walls),
    [],
  );
  assert.deepEqual(
    byId(resize(original, 160), "branch"),
    byId(original, "branch"),
  );
  const legacy = fixture(wall("branch", [3000, 3000], [5000, 3000]));
  assert.deepEqual(
    wallFaceAttachments(byId(legacy, "host"), legacy.plan.walls),
    [],
  );
  assert.deepEqual(byId(resize(legacy, 320), "branch").a, [3000, 3000]);
});
test("protected and unreviewed face-attached neighbours block the entire edit rather than silently moving", () => {
  for (const kind of ["bearing", "exterior", "unknown", "partition"] as const) {
    const original = fixture(),
      branch = byId(original, "branch");
    branch.kind = kind;
    if (kind === "partition") branch.reviewed = false;
    rejected(original, 320, "CONNECTED_WALL_LOCKED");
  }
});
test("linked endpoints cannot create short or reversed walls and cannot cut into existing openings", () => {
  rejected(
    fixture(wall("branch", [3120, 3000], [3250, 3000])),
    320,
    "WALL_JOIN_CONFLICT",
  );
  rejected(
    fixture(wall("branch", [3120, 3000], [3300, 3000])),
    1200,
    "WALL_JOIN_CONFLICT",
  );
  const original = fixture();
  original.plan.openings.push({
    id: "door",
    wallId: "branch",
    kind: "door",
    offset: 20,
    width: 800,
    height: 2100,
    sill: 0,
    swing: "left",
  });
  rejected(original, 320, "WALL_JOIN_OPENING_CONFLICT");
});
test("a linked endpoint cannot detach another existing face junction", () => {
  const original = fixture();
  original.plan.walls.push(wall("third", [3180, 2600], [3180, 2940], 40));
  const attachment = wallFaceAttachments(
    byId(original, "branch"),
    original.plan.walls,
  ).find((a) => a.wallId === "third")!;
  assert.ok(attachment);
  assert.ok(
    wallFaceAttachmentFits(
      byId(original, "branch"),
      byId(original, "third"),
      attachment,
    ),
  );
  rejected(original, 400, "WALL_JOIN_CONFLICT");
});
test("the entire linked update is one revision and can be undone and redone together", () => {
  const original = fixture(),
    changed = resize(original, 320);
  assert.equal(changed.revision, 1);
  assert.equal(changed.history.length, 1);
  near(wallLength(byId(changed, "branch")), 1840);
  const undone = applyCommands(changed, [{ type: "undo" }], "user");
  assert.deepEqual(undone.plan, original.plan);
  const redone = applyCommands(undone, [{ type: "redo" }], "user");
  assert.deepEqual(redone.plan, changed.plan);
});

test("rotated hosts follow the face normal and keep the branch axis and free end fixed", () => {
  for (const degrees of [15, 37, 120, 225]) {
    const angle = (degrees * Math.PI) / 180,
      u: Point = [Math.cos(angle), Math.sin(angle)],
      n: Point = [-u[1], u[0]];
    const start: Point = [3000 + n[0] * 120, 3000 + n[1] * 120],
      end: Point = [3000 + n[0] * 1500, 3000 + n[1] * 1500];
    const original = fixture(wall("branch", start, end)),
      host = byId(original, "host");
    host.a = [3000 - u[0] * 1800, 3000 - u[1] * 1800];
    host.b = [3000 + u[0] * 1800, 3000 + u[1] * 1800];
    const next = resize(original, 320),
      branch = byId(next, "branch");
    near(branch.a[0], 3000 + n[0] * 160);
    near(branch.a[1], 3000 + n[1] * 160);
    assert.deepEqual(branch.b, end);
    assertNoOverlap(next);
  }
});
