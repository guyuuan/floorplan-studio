import test from "node:test";
import assert from "node:assert/strict";
import { demoPlan } from "../src/domain/demo";
import { applyCommands } from "../src/domain/engine";
import { doorSwingSide, hingedDoorLeaves } from "../src/domain/openings";
import { planSchema, type Project, type Wall } from "../src/domain/schema";

test("explicit inward on an exterior door faces the building regardless of wall direction; legacy doors keep their wall side", () => {
  const { walls, openings, boundary } = demoPlan();
  const entry = openings.find((o) => o.id === "entry")!;
  const wall = walls.find((w) => w.id === entry.wallId)!;
  const reversed: Wall = { ...wall, a: wall.b, b: wall.a };
  for (const [w, inward] of [
    [wall, 1],
    [reversed, -1],
  ] as const) {
    assert.equal(doorSwingSide(entry, w, boundary), 1);
    assert.equal(
      doorSwingSide({ ...entry, swingDirection: "inward" }, w, boundary),
      inward,
    );
    assert.equal(
      doorSwingSide({ ...entry, swingDirection: "outward" }, w, boundary),
      -inward,
    );
  }
});

test("opening direction flips the wall side while keeping the hinge positions for single and double doors", () => {
  const { walls, openings, boundary } = demoPlan();
  const wall = walls.find((w) => w.id === "middle")!;
  const left = openings.find((o) => o.id === "bed_door")!;
  const right = openings.find((o) => o.id === "study_door")!;
  const double = { ...left, doorStyle: "double" } as const;
  for (const [door, hinges] of [
    [left, [[0, 1, 900]]],
    [right, [[900, -1, 900]]],
    [
      double,
      [
        [0, 1, 450],
        [900, -1, 450],
      ],
    ],
  ] as const) {
    for (const [swingDirection, side] of [
      ["inward", 1],
      ["outward", -1],
    ] as const) {
      const changed = { ...door, swingDirection };
      assert.equal(doorSwingSide(changed, wall, boundary), side);
      assert.deepEqual(
        hingedDoorLeaves(changed).map((leaf) => [
          leaf.offset,
          leaf.alongSign,
          leaf.width,
        ]),
        hinges,
      );
    }
  }
  for (const doorStyle of ["sliding", "opening"] as const)
    assert.deepEqual(hingedDoorLeaves({ ...left, doorStyle }), []);
});

test("changing a door direction persists through commands and JSON, and supports undo and redo", () => {
  const project: Project = {
    schemaVersion: 1,
    id: "door_swing_test",
    name: "door_swing_test",
    revision: 0,
    createdAt: "",
    updatedAt: "",
    stage: "design",
    calibrated: true,
    source: null,
    plan: demoPlan(),
    history: [],
    future: [],
    activity: [],
  };
  const opening = project.plan.openings.find((o) => o.id === "entry")!;
  const changed = applyCommands(
    project,
    [
      {
        type: "upsert_opening",
        opening: { ...opening, swingDirection: "outward" },
      },
    ],
    "user",
  );
  const direction = (plan: Project["plan"]) =>
    plan.openings.find((o) => o.id === opening.id)?.swingDirection;
  assert.equal(
    direction(planSchema.parse(JSON.parse(JSON.stringify(changed.plan)))),
    "outward",
  );
  const undone = applyCommands(changed, [{ type: "undo" }], "user");
  assert.equal(direction(undone.plan), undefined);
  assert.equal(
    direction(applyCommands(undone, [{ type: "redo" }], "user").plan),
    "outward",
  );
});
