import test from "node:test";
import assert from "node:assert/strict";
import { applyCommands, RuleError, validatePlan } from "../src/domain/engine";
import { demoPlan } from "../src/domain/demo";
import { roomArea, wallLength } from "../src/domain/geometry";
import { doorStyle, doorLeafCount, fitOpening } from "../src/domain/openings";
import type { Project, Command } from "../src/domain/schema";

function fixture(): Project {
  const plan = demoPlan();
  plan.walls.forEach((w) => (w.reviewed = true));
  return {
    schemaVersion: 1,
    id: "test",
    name: "test",
    revision: 0,
    createdAt: "",
    updatedAt: "",
    plan,
    stage: "design",
    calibrated: true,
    source: null,
    history: [],
    future: [],
    activity: [],
  };
}
function denied(
  command: Command,
  code: string,
  p = fixture(),
  actor: "user" | "agent" = "agent",
) {
  assert.throws(
    () => applyCommands(p, [command], actor),
    (e: unknown) => e instanceof RuleError && e.code === code,
  );
}
test("example plan is valid and has five enclosed spaces", () => {
  const p = fixture();
  validatePlan(p.plan);
  assert.equal(p.plan.rooms.length, 5);
  assert.ok(p.plan.rooms.reduce((s, r) => s + roomArea(r), 0) > 90);
});
test("agent cannot move, resize, remove, or pierce exterior walls", () => {
  for (const c of [
    { type: "update_wall", wallId: "ext_n", thickness: 120 },
    { type: "update_wall", wallId: "ext_n", a: [100, 100] },
    { type: "remove_wall", wallId: "ext_n" },
    {
      type: "upsert_opening",
      opening: {
        id: "new_door",
        wallId: "ext_n",
        kind: "door",
        offset: 500,
        width: 800,
        height: 2100,
        sill: 0,
        swing: "left",
      },
    },
  ] as Command[])
    denied(c, "EXTERIOR_LOCKED");
});
test("agent cannot move, delete, or reparent existing exterior windows and doors", () => {
  const p = fixture();
  for (const o of p.plan.openings.filter((o) => o.wallId.startsWith("ext_"))) {
    denied({ type: "delete_opening", openingId: o.id }, "EXTERIOR_LOCKED");
    denied(
      { type: "upsert_opening", opening: { ...o, offset: o.offset + 10 } },
      "EXTERIOR_LOCKED",
    );
    denied(
      {
        type: "upsert_opening",
        opening: { ...o, wallId: "middle", offset: 600 },
      },
      "EXTERIOR_LOCKED",
    );
  }
});
test("user can edit, delete and recreate openings on every wall type in either stage", () => {
  for (const kind of ["exterior", "bearing", "partition", "unknown"] as const) {
    for (const stage of ["reconstruction", "design"] as const) {
      let p = fixture();
      p.stage = stage;
      const entry = p.plan.openings.find((o) => o.id === "entry")!;
      const wall = p.plan.walls.find((w) => w.id === entry.wallId)!;
      wall.kind = kind;
      wall.reviewed = false;
      const walls = structuredClone(p.plan.walls);
      p = applyCommands(
        p,
        [
          {
            type: "upsert_opening",
            opening: {
              ...entry,
              offset: 900,
              width: 2200,
              doorStyle: "sliding",
            },
          },
        ],
        "user",
      );
      assert.equal(p.plan.openings.find((o) => o.id === entry.id)!.width, 2200);
      p = applyCommands(
        p,
        [{ type: "delete_opening", openingId: entry.id }],
        "user",
      );
      assert.ok(!p.plan.openings.some((o) => o.id === entry.id));
      p = applyCommands(
        p,
        [
          {
            type: "upsert_opening",
            opening: { ...entry, kind: "window", height: 1300, sill: 800 },
          },
        ],
        "user",
      );
      assert.equal(
        p.plan.openings.find((o) => o.id === entry.id)!.kind,
        "window",
      );
      assert.deepEqual(p.plan.walls, walls);
      assert.equal(p.stage, stage);
    }
  }
});
test("user can move an exterior opening to a bearing wall without changing either wall", () => {
  const p = fixture(),
    o = p.plan.openings.find((o) => o.id === "entry")!;
  const changed = applyCommands(
    p,
    [
      {
        type: "upsert_opening",
        opening: { ...o, wallId: "bedroom_wall", offset: 500 },
      },
    ],
    "user",
  );
  assert.equal(
    changed.plan.openings.find((o) => o.id === "entry")!.wallId,
    "bedroom_wall",
  );
  assert.deepEqual(changed.plan.walls, p.plan.walls);
});
test("user opening corrections retain bounds, overlap and height validation and can be undone", () => {
  const p = fixture(),
    o = p.plan.openings.find((o) => o.id === "entry")!;
  denied(
    { type: "upsert_opening", opening: { ...o, offset: 12000 } },
    "OPENING_OUT_OF_WALL",
    p,
    "user",
  );
  denied(
    { type: "upsert_opening", opening: { ...o, height: 3000 } },
    "OPENING_TOO_HIGH",
    p,
    "user",
  );
  denied(
    { type: "upsert_opening", opening: { ...o, id: "duplicate_entry" } },
    "OVERLAPPING_OPENINGS",
    p,
    "user",
  );
  const deleted = applyCommands(
    p,
    [{ type: "delete_opening", openingId: o.id }],
    "user",
  );
  const restored = applyCommands(deleted, [{ type: "undo" }], "user");
  assert.deepEqual(restored.plan, validatePlan(p.plan));
  denied(
    { type: "remove_wall", wallId: o.wallId },
    "EXTERIOR_LOCKED",
    deleted,
    "user",
  );
});
test("agent restoration requires an explicit, plausible style for wide doors but accepts broad windows", () => {
  const p = fixture();
  p.stage = "reconstruction";
  const o = p.plan.openings.find((o) => o.id === "entry")!;
  o.width = 2200;
  denied(
    { type: "restore_plan", plan: p.plan },
    "DOOR_WIDTH_REVIEW_REQUIRED",
    p,
  );
  o.doorStyle = "single";
  denied({ type: "restore_plan", plan: p.plan }, "DOOR_LEAF_TOO_WIDE", p);
  for (const style of ["double", "sliding", "opening"] as const) {
    o.doorStyle = style;
    const restored = applyCommands(
      p,
      [{ type: "restore_plan", plan: p.plan }],
      "agent",
    );
    assert.equal(
      restored.plan.openings.find((x) => x.id === o.id)!.doorStyle,
      style,
    );
    assert.equal(
      restored.plan.openings.find((x) => x.id === o.id)!.width,
      2200,
    );
  }
  o.doorStyle = "double";
  o.width = 2600;
  denied({ type: "restore_plan", plan: p.plan }, "DOOR_LEAF_TOO_WIDE", p);
});
test("agent design commands also validate wide doors and preserve an atomic batch on failure", () => {
  const p = fixture(),
    o = p.plan.openings.find((o) => o.id === "study_door")!;
  const before = structuredClone(p);
  denied(
    { type: "upsert_opening", opening: { ...o, width: 1600 } },
    "DOOR_WIDTH_REVIEW_REQUIRED",
    p,
  );
  assert.throws(() =>
    applyCommands(
      p,
      [
        {
          type: "update_room",
          roomId: p.plan.rooms[0].id,
          name: "must not save",
        },
        {
          type: "upsert_opening",
          opening: { ...o, width: 1600, doorStyle: "single" },
        },
      ],
      "agent",
    ),
  );
  assert.deepEqual(p, before);
  const changed = applyCommands(
    p,
    [
      {
        type: "upsert_opening",
        opening: { ...o, width: 1600, doorStyle: "double" },
      },
    ],
    "agent",
  );
  assert.equal(changed.plan.openings.find((x) => x.id === o.id)!.width, 1600);
});
test("legacy wide doors render as multiple sliding leaves without changing their stored width", () => {
  const o = {
    ...fixture().plan.openings.find((o) => o.id === "entry")!,
    width: 2200,
  };
  assert.equal(doorStyle(o), "sliding");
  assert.equal(doorLeafCount(o), 2);
  assert.equal(doorLeafCount({ ...o, width: 3600 }), 3);
  assert.equal(doorStyle({ ...o, width: 900 }), "single");
  assert.equal(doorLeafCount({ ...o, doorStyle: "double" }), 2);
  assert.equal(doorLeafCount({ ...o, doorStyle: "opening" }), 0);
  assert.equal(o.width, 2200);
});
test("bearing walls are protected; agent cannot reclassify or use user undo", () => {
  denied({ type: "remove_wall", wallId: "bedroom_wall" }, "BEARING_LOCKED");
  denied(
    { type: "update_wall", wallId: "bedroom_wall", thickness: 100 },
    "BEARING_LOCKED",
  );
  denied(
    { type: "classify_wall", wallId: "bedroom_wall", kind: "partition" },
    "USER_REVIEW_REQUIRED",
  );
  denied({ type: "undo" }, "USER_REVIEW_REQUIRED");
});
test("user can correct a mistaken wall classification, agent can only then edit it", () => {
  const p = fixture();
  p.plan.furniture = [];
  const classified = applyCommands(
    p,
    [{ type: "classify_wall", wallId: "bedroom_wall", kind: "partition" }],
    "user",
  );
  const modified = applyCommands(
    classified,
    [{ type: "update_wall", wallId: "bedroom_wall", thickness: 140 }],
    "agent",
  );
  assert.equal(
    modified.plan.walls.find((w) => w.id === "bedroom_wall")!.thickness,
    140,
  );
});
test("unknown and unreviewed walls cannot be edited", () => {
  const p = fixture();
  p.plan.walls.find((w) => w.id === "middle")!.reviewed = false;
  denied({ type: "remove_wall", wallId: "middle" }, "UNREVIEWED_WALL", p);
});
test("partial demolition creates two walls, remaps right-hand openings, removes affected openings", () => {
  const p = fixture();
  p.plan.furniture = [];
  const before = p.plan.walls.find((w) => w.id === "middle")!;
  const next = applyCommands(
    p,
    [{ type: "remove_wall", wallId: "middle", from: 3000, to: 4200 }],
    "agent",
  );
  const pieces = next.plan.walls.filter((w) => w.id.startsWith("middle"));
  assert.equal(pieces.length, 2);
  assert.equal(wallLength(pieces[0]), 3000);
  assert.equal(wallLength(pieces[1]), wallLength(before) - 4200);
  assert.ok(!next.plan.openings.some((o) => o.id === "bed_door"));
  assert.equal(
    next.plan.openings.find((o) => o.id === "study_door")!.offset,
    1700,
  );
  assert.equal(next.plan.rooms.length, 4);
});
test("interior door openings can move and change width", () => {
  const p = fixture(),
    o = p.plan.openings.find((o) => o.id === "study_door")!;
  const next = applyCommands(
    p,
    [{ type: "upsert_opening", opening: { ...o, offset: 5200, width: 1000 } }],
    "agent",
  );
  assert.equal(next.plan.openings.find((x) => x.id === o.id)!.offset, 5200);
});
test("atomic batch rolls back prior commands when later command violates a lock", () => {
  const p = fixture(),
    before = structuredClone(p);
  assert.throws(() =>
    applyCommands(
      p,
      [
        { type: "update_room", roomId: p.plan.rooms[0].id, name: "new" },
        { type: "remove_wall", wallId: "ext_n" },
      ],
      "agent",
    ),
  );
  assert.deepEqual(p, before);
});
test("design stage cannot be overwritten by a full plan replacement", () => {
  denied({ type: "restore_plan", plan: fixture().plan }, "STRUCTURE_CONFIRMED");
});
test("restoration clears review and scale; only user can approve after calibration", () => {
  const p = fixture();
  p.stage = "reconstruction";
  const restored = applyCommands(
    p,
    [{ type: "restore_plan", plan: p.plan }],
    "agent",
  );
  assert.ok(restored.plan.walls.every((w) => !w.reviewed));
  assert.equal(restored.calibrated, false);
  denied({ type: "confirm_structure" }, "USER_REVIEW_REQUIRED", restored);
  denied({ type: "confirm_structure" }, "SCALE_REQUIRED", restored, "user");
  const ready = applyCommands(
    restored,
    [
      { type: "calibrate", measuredLength: 12000, actualLength: 12000 },
      { type: "review_walls" },
      { type: "confirm_structure" },
    ],
    "user",
  );
  assert.equal(ready.stage, "design");
});
test("undo and redo restore full geometry, classification and review stage", () => {
  const p = fixture();
  const changed = applyCommands(
    p,
    [{ type: "classify_wall", wallId: "middle", kind: "bearing" }],
    "user",
  );
  const undone = applyCommands(changed, [{ type: "undo" }], "user");
  assert.equal(
    undone.plan.walls.find((w) => w.id === "middle")!.kind,
    "partition",
  );
  const redone = applyCommands(undone, [{ type: "redo" }], "user");
  assert.equal(
    redone.plan.walls.find((w) => w.id === "middle")!.kind,
    "bearing",
  );
  assert.equal(redone.revision, 3);
});
test("doors cannot exceed their wall, overlap, or extend above the ceiling", () => {
  const p = fixture(),
    o = p.plan.openings.find((o) => o.id === "study_door")!;
  denied(
    { type: "upsert_opening", opening: { ...o, offset: 12000 } },
    "OPENING_OUT_OF_WALL",
  );
  denied(
    { type: "upsert_opening", opening: { ...o, offset: 3100 } },
    "OVERLAPPING_OPENINGS",
  );
  denied(
    { type: "upsert_opening", opening: { ...o, height: 3000 } },
    "OPENING_TOO_HIGH",
  );
});
test("furniture cannot be placed outside the footprint or inside a wall", () => {
  const p = fixture(),
    f = p.plan.furniture.find((f) => f.type === "bed")!;
  denied(
    { type: "upsert_furniture", furniture: { ...f, position: [0, 0] } },
    "FURNITURE_OUTSIDE",
  );
  denied(
    { type: "upsert_furniture", furniture: { ...f, position: [4400, 1800] } },
    "FURNITURE_IN_WALL",
  );
});
test("new walls must be interior partitions and remain within the footprint", () => {
  const w = fixture().plan.walls.find((w) => w.id === "middle")!;
  denied(
    { type: "add_wall", wall: { ...w, id: "new", kind: "bearing" } },
    "PARTITION_ONLY",
  );
  denied(
    {
      type: "add_wall",
      wall: { ...w, id: "new", a: [-1000, 6000], b: [-1000, 8000] },
    },
    "OUTSIDE_BOUNDARY",
  );
});
test("invalid geometry rejects duplicate IDs and self-intersecting boundaries", () => {
  const p = fixture().plan;
  p.walls.push({ ...p.walls[0] });
  assert.throws(() => validatePlan(p), /ID/);
  p.walls.pop();
  p.furniture = [];
  p.boundary = [
    [0, 0],
    [12000, 9000],
    [0, 9000],
    [12000, 0],
    [16000, 0],
  ];
  assert.throws(() => validatePlan(p));
});

test("manual opening placement uses the free wall interval and never overlaps adjacent openings", () => {
  const p = fixture(),
    wall = p.plan.walls.find((w) => w.id === "middle")!;
  const placed = fitOpening(wall, p.plan.openings, 5700, "door")!;
  assert.equal(placed.width, 900);
  assert.ok(placed.offset + placed.width <= 5900);
  assert.equal(fitOpening(wall, p.plan.openings, 6200, "door"), null);
  const smallWall = {
    ...wall,
    a: [0, 0] as [number, number],
    b: [650, 0] as [number, number],
    height: 500,
  };
  assert.deepEqual(fitOpening(smallWall, [], 600, "door"), {
    offset: 0,
    width: 650,
    height: 500,
    sill: 0,
    swing: "left",
  });
  assert.equal(
    fitOpening({ ...smallWall, b: [190, 0] }, [], 100, "door"),
    null,
  );
  const window = fitOpening(smallWall, [], 100, "window")!;
  assert.ok(window.sill + window.height <= smallWall.height);
});
