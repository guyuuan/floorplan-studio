import test from "node:test";
import assert from "node:assert/strict";
import { applyCommands, RuleError, validatePlan } from "../src/domain/engine";
import { demoPlan } from "../src/domain/demo";
import {
  doorLeafCount,
  getOpeningType,
  withOpeningType,
} from "../src/domain/openings";
import { openingSchema, planSchema, type Project } from "../src/domain/schema";
function fixture(): Project {
  const plan = validatePlan(demoPlan());
  plan.walls.forEach((w) => (w.reviewed = true));
  return {
    schemaVersion: 1,
    id: "passage_test",
    name: "passage_test",
    revision: 0,
    createdAt: "",
    updatedAt: "",
    source: null,
    stage: "design",
    calibrated: true,
    plan,
    history: [],
    future: [],
    activity: [],
  };
}
test("removing a door leaf retains the opening dimensions and position while creating a floor-level passage", () => {
  const door = {
      ...fixture().plan.openings.find((o) => o.id === "entry")!,
      sill: 100,
    },
    before = structuredClone(door);
  const passage = withOpeningType(door, "passage");
  assert.deepEqual(passage, {
    ...door,
    kind: "door",
    doorStyle: "opening",
    sill: 0,
  });
  assert.equal(getOpeningType(passage), "passage");
  assert.equal(doorLeafCount(passage), 0);
  assert.deepEqual(door, before);
});
test("a passage can become a normal door or window without retaining the no-leaf mode", () => {
  const passage = withOpeningType(
    fixture().plan.openings.find((o) => o.id === "entry")!,
    "passage",
  );
  const door = withOpeningType(passage, "door"),
    window = withOpeningType(passage, "window");
  assert.equal(getOpeningType(door), "door");
  assert.ok(doorLeafCount(door) > 0);
  assert.equal(door.doorStyle, undefined);
  assert.equal(getOpeningType(window), "window");
  assert.equal(window.doorStyle, undefined);
  const sourceWindow = fixture().plan.openings.find(
    (o) => o.kind === "window",
  )!;
  const fromWindow = withOpeningType(sourceWindow, "passage");
  assert.equal(fromWindow.sill, 0);
  assert.equal(fromWindow.width, sourceWindow.width);
  assert.equal(fromWindow.height, sourceWindow.height);
});
test("user passage corrections retain the opening and respect every wall class and project stage", () => {
  for (const kind of ["exterior", "bearing", "unknown", "partition"] as const)
    for (const stage of ["reconstruction", "design"] as const) {
      const p = fixture();
      p.stage = stage;
      const opening = p.plan.openings.find((o) => o.id === "entry")!,
        wall = p.plan.walls.find((w) => w.id === opening.wallId)!;
      wall.kind = kind;
      wall.reviewed = false;
      const changed = applyCommands(
        p,
        [
          {
            type: "upsert_opening",
            opening: withOpeningType(opening, "passage"),
          },
        ],
        "user",
      );
      assert.equal(changed.plan.openings.length, p.plan.openings.length);
      assert.equal(
        getOpeningType(changed.plan.openings.find((o) => o.id === opening.id)!),
        "passage",
      );
      assert.deepEqual(changed.plan.walls, p.plan.walls);
      assert.equal(changed.stage, stage);
    }
});
test("converting to a passage and filling an opening are separate, undoable operations", () => {
  const p = fixture(),
    opening = p.plan.openings.find((o) => o.id === "entry")!;
  const passage = applyCommands(
    p,
    [{ type: "upsert_opening", opening: withOpeningType(opening, "passage") }],
    "user",
  );
  const filled = applyCommands(
    passage,
    [{ type: "delete_opening", openingId: opening.id }],
    "user",
  );
  assert.equal(filled.plan.openings.length, p.plan.openings.length - 1);
  assert.deepEqual(filled.plan.walls, p.plan.walls);
  const restoredPassage = applyCommands(filled, [{ type: "undo" }], "user");
  assert.deepEqual(restoredPassage.plan, passage.plan);
  const restoredDoor = applyCommands(
    restoredPassage,
    [{ type: "undo" }],
    "user",
  );
  assert.deepEqual(restoredDoor.plan, p.plan);
  const redone = applyCommands(restoredDoor, [{ type: "redo" }], "user");
  assert.deepEqual(redone.plan, passage.plan);
});
test("passages survive JSON/schema round trips and legacy doors remain doors", () => {
  const p = fixture(),
    opening = p.plan.openings.find((o) => o.id === "entry")!;
  const legacy = openingSchema.parse(opening);
  assert.equal(getOpeningType(legacy), "door");
  p.plan.openings = p.plan.openings.map((o) =>
    o.id === opening.id ? withOpeningType(o, "passage") : o,
  );
  const roundTrip = planSchema.parse(JSON.parse(JSON.stringify(p.plan)));
  const passage = roundTrip.openings.find((o) => o.id === opening.id)!;
  assert.equal(getOpeningType(passage), "passage");
  assert.equal(doorLeafCount(passage), 0);
});
test("passage conversion keeps bounds and overlap checks, and cannot bypass agent protection", () => {
  const p = fixture(),
    opening = withOpeningType(
      p.plan.openings.find((o) => o.id === "entry")!,
      "passage",
    ),
    before = structuredClone(p);
  for (const [change, code] of [
    [{ ...opening, offset: 8000 }, "OPENING_OUT_OF_WALL"],
    [{ ...opening, id: "duplicate" }, "OVERLAPPING_OPENINGS"],
  ] as const) {
    assert.throws(
      () =>
        applyCommands(p, [{ type: "upsert_opening", opening: change }], "user"),
      (e) => e instanceof RuleError && e.code === code,
    );
    assert.deepEqual(p, before);
  }
  assert.throws(
    () => applyCommands(p, [{ type: "upsert_opening", opening }], "agent"),
    (e) => e instanceof RuleError && e.code === "EXTERIOR_LOCKED",
  );
});
