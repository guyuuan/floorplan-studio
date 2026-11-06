import test from "node:test";
import assert from "node:assert/strict";
import polygonClipping from "polygon-clipping";
import { applyCommands, RuleError } from "../src/domain/engine";
import {
  area,
  along,
  connectWallEndpoints,
  deriveRooms,
  wallFootprints,
  wallOutline,
  wallPolygon,
} from "../src/domain/geometry";
import type { Plan, Point, Project, Wall } from "../src/domain/schema";
const wall = (id: string, a: Point, b: Point, thickness = 120): Wall => ({
  id,
  a,
  b,
  thickness,
  height: 2800,
  kind: "partition",
  reviewed: true,
});
const host = (thickness = 240) => ({
  ...wall("host", [1000, 3000], [5000, 3000], thickness),
  kind: "bearing" as const,
});
const plan = (walls: Wall[]): Plan => ({
  units: "mm",
  boundary: [
    [0, 0],
    [6000, 0],
    [6000, 6000],
    [0, 6000],
  ],
  walls,
  openings: [],
  furniture: [],
  rooms: [],
});
const project = (walls: Wall[]): Project => ({
  schemaVersion: 1,
  id: "wall_test",
  name: "wall_test",
  revision: 0,
  createdAt: "",
  updatedAt: "",
  source: null,
  calibrated: true,
  stage: "design",
  history: [],
  future: [],
  activity: [],
  plan: plan(walls),
});
const surface = (polygons: polygonClipping.MultiPolygon) =>
  polygons.reduce(
    (sum, p) =>
      sum +
      area(p[0] as Point[]) -
      p.slice(1).reduce((holes, ring) => holes + area(ring as Point[]), 0),
    0,
  );
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test("wall coordinates are centered across thickness and free end caps never extend", () => {
  assert.deepEqual(wallPolygon(wall("line", [1000, 1000], [4000, 1000], 240)), [
    [1000, 1120],
    [4000, 1120],
    [4000, 880],
    [1000, 880],
  ]);
});
test("L joints with unequal thickness use the same miter seam without a gap or solid overlap", () => {
  const walls = [
    wall("horizontal", [1000, 1000], [4000, 1000], 240),
    wall("vertical", [4000, 1000], [4000, 4000], 120),
  ];
  const a = wallOutline(walls[0], walls),
    b = wallOutline(walls[1], walls);
  assert.deepEqual(a[1], [3940, 1120]);
  assert.deepEqual(a[2], [4060, 880]);
  assert.deepEqual(b[0], a[1]);
  assert.deepEqual(b[3], a[2]);
  near(surface(polygonClipping.intersection([a], [b])), 0);
  near(surface(polygonClipping.union([a], [b])), 3000 * 240 + 3000 * 120);
});
test("T joints snap centerline ends to the host face at different angles, directions and thicknesses", () => {
  for (const thickness of [120, 240, 400])
    for (const endpoint of [
      [4500, 5000],
      [3000, 5000],
      [1500, 5000],
      [3000, 1000],
    ] as Point[]) {
      const existing = host(thickness),
        requested = wall("new", [3000, 3000], endpoint);
      const connected = connectWallEndpoints(requested, [existing]);
      const sign = Math.sign(endpoint[1] - 3000),
        expectedY = 3000 + (sign * thickness) / 2;
      near(connected.a[1], expectedY);
      const outline = wallOutline(connected, [existing, connected]);
      near(outline[0][1], expectedY);
      near(outline[3][1], expectedY);
      near(
        surface(
          polygonClipping.intersection(
            [outline],
            [wallOutline(existing, [existing, connected])],
          ),
        ),
        0,
      );
      assert.deepEqual(connectWallEndpoints(connected, [existing]), connected);
      const reversed = connectWallEndpoints(
        { ...requested, a: requested.b, b: requested.a },
        [existing],
      );
      near(reversed.b[0], connected.a[0]);
      near(reversed.b[1], connected.a[1]);
    }
});
test("a new perpendicular corner aligns outer edges using half its own thickness", () => {
  const connected = connectWallEndpoints(
    wall("corner", [5000, 3000], [5000, 5000]),
    [host()],
  );
  assert.deepEqual(connected.a, [4940, 3120]);
  assert.deepEqual(connected.b, [4940, 5000]);
  const polygon = wallOutline(connected, [host(), connected]);
  near(Math.max(...polygon.map((p) => p[0])), 5000);
  near(
    surface(
      polygonClipping.intersection(
        [polygon],
        [wallOutline(host(), [host(), connected])],
      ),
    ),
    0,
  );
});
test("legacy centerline T junctions share a disjoint physical footprint without rewriting protected coordinates", () => {
  const walls = [host(), wall("legacy", [3000, 3000], [3000, 5000])],
    original = structuredClone(walls);
  const footprints = wallFootprints(walls);
  near(
    surface(polygonClipping.intersection(footprints.host, footprints.legacy)),
    0,
  );
  near(
    surface(polygonClipping.union(footprints.host, footprints.legacy)),
    surface(
      polygonClipping.union(
        [wallOutline(walls[0], walls)],
        [wallOutline(walls[1], walls)],
      ),
    ),
  );
  assert.deepEqual(walls, original);
});
test("new walls and edits cannot cross, duplicate or overlap parallel walls; failed commands stay atomic", () => {
  for (const candidate of [
    wall("cross", [3000, 1000], [3000, 5000]),
    wall("parallel", [1000, 3050], [5000, 3050]),
    wall("duplicate", [1000, 3000], [5000, 3000]),
  ]) {
    const original = project([host()]),
      before = structuredClone(original);
    assert.throws(
      () =>
        applyCommands(
          original,
          [{ type: "add_wall", wall: candidate }],
          "agent",
        ),
      (e) => e instanceof RuleError && e.code === "WALL_INTERSECTION",
    );
    assert.deepEqual(original, before);
  }
  const original = project([host(), wall("free", [3000, 4000], [3000, 5000])]);
  assert.throws(
    () =>
      applyCommands(
        original,
        [{ type: "update_wall", wallId: "free", a: [3000, 1000] }],
        "user",
      ),
    (e) => e instanceof RuleError && e.code === "WALL_INTERSECTION",
  );
});
test("adding a wall stores fitted endpoints, retains host protection and supports undo", () => {
  const original = project([host()]);
  const next = applyCommands(
    original,
    [{ type: "add_wall", wall: wall("new", [3000, 3000], [3000, 5000]) }],
    "agent",
  );
  assert.deepEqual(
    next.plan.walls.find((w) => w.id === "new")!.a,
    [3000, 3120],
  );
  assert.deepEqual(
    next.plan.walls.find((w) => w.id === "host"),
    original.plan.walls[0],
  );
  assert.deepEqual(
    applyCommands(next, [{ type: "undo" }], "user").plan,
    original.plan,
  );
});
test("manual wall edits keep exact Y coordinates at the ends of intersecting walls", () => {
  const left = {
      ...host(),
      a: [1000, 2000] as Point,
      b: [1000, 4500] as Point,
    },
    right = wall("right", [5000, 2000], [5000, 4500], 240),
    original = project([
      left,
      right,
      wall("edited", [1120, 2200], [4880, 2200]),
    ]);
  const a: Point = [1120, 2020.25],
    b: Point = [4880, 2020.25];
  const command = { type: "update_wall", wallId: "edited", a, b };
  const manual = applyCommands(original, [command], "user"),
    edited = manual.plan.walls.find((w) => w.id === "edited")!;
  assert.deepEqual([edited.a, edited.b], [a, b]);
  assert.deepEqual(
    manual.plan.walls.slice(0, 2),
    original.plan.walls.slice(0, 2),
  );
  const adjusted = applyCommands(original, [command], "agent").plan.walls[2];
  assert.deepEqual(
    [adjusted.a, adjusted.b],
    [
      [1120, 2060],
      [4880, 2060],
    ],
  );

  const heightOnly = applyCommands(
    manual,
    [{ ...command, height: 2600 }],
    "user",
  ).plan.walls[2];
  assert.deepEqual(
    [heightOnly.a, heightOnly.b, heightOnly.height],
    [a, b, 2600],
  );
});

test("a manual endpoint can leave a gap, but an overlapping endpoint is rejected without moving either wall", () => {
  const original = project([
    host(),
    wall("branch", [3000, 3120], [3000, 5000]),
  ]);
  const moved = applyCommands(
    original,
    [{ type: "update_wall", wallId: "branch", a: [3000, 3140] }],
    "user",
  );
  assert.deepEqual(moved.plan.walls[1].a, [3000, 3140]);
  assert.deepEqual(moved.plan.walls[1].b, original.plan.walls[1].b);
  const before = structuredClone(original);
  assert.throws(
    () =>
      applyCommands(
        original,
        [{ type: "update_wall", wallId: "branch", a: [3000, 3100] }],
        "user",
      ),
    (e) => e instanceof RuleError && e.code === "WALL_INTERSECTION",
  );
  assert.deepEqual(original, before);
});

test("fitting an edited wall keeps existing openings at the requested world position", () => {
  const original = project([
    host(),
    wall("legacy", [3000, 3000], [3000, 5000]),
  ]);
  original.plan.openings.push({
    id: "door",
    wallId: "legacy",
    kind: "door",
    offset: 500,
    width: 800,
    height: 2100,
    sill: 0,
    swing: "left",
  });
  const next = applyCommands(
    original,
    [{ type: "update_wall", wallId: "legacy", thickness: 160 }],
    "user",
  );
  const w = next.plan.walls.find((w) => w.id === "legacy")!,
    opening = next.plan.openings[0];
  near(opening.offset, 380);
  assert.deepEqual(along(w, opening.offset), [3000, 3500]);
});
test("closed exterior corners fill the outer boundary and produce the same inner room area", () => {
  const walls = [
    wall("n", [120, 120], [5880, 120], 240),
    wall("e", [5880, 120], [5880, 5880], 240),
    wall("s", [5880, 5880], [120, 5880], 240),
    wall("w", [120, 5880], [120, 120], 240),
  ].map((w) => ({ ...w, kind: "exterior" as const }));
  const footprints = wallFootprints(walls),
    rooms = deriveRooms(plan(walls));
  assert.equal(rooms.length, 1);
  near(area(rooms[0].polygon), 5520 ** 2);
  near(
    Object.values(footprints).reduce(
      (sum, footprint) => sum + surface(footprint),
      0,
    ),
    6000 ** 2 - 5520 ** 2,
  );
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++)
      near(
        surface(
          polygonClipping.intersection(
            footprints[walls[i].id],
            footprints[walls[j].id],
          ),
        ),
        0,
      );
});

test("zero-length and too-short wall edits fail as validation errors before polygon operations", () => {
  const original = project([host(), wall("free", [3000, 4000], [3000, 5000])]);
  for (const command of [
    { type: "add_wall", wall: wall("zero", [3000, 4000], [3000, 4000]) },
    { type: "update_wall", wallId: "free", a: [3000, 5000] },
  ])
    assert.throws(
      () => applyCommands(original, [command], "user"),
      (e) => e instanceof RuleError && e.code === "WALL_TOO_SHORT",
    );
});

test("editing the thickness of an existing T-junction host is not mistaken for a crossing", () => {
  const branch = {
    ...wall("branch", [3000, 1000], [3000, 3000], 240),
    kind: "bearing" as const,
  };
  const original = project([
    wall("receiver", [1000, 3000], [5000, 3000]),
    branch,
  ]);
  const updated = applyCommands(
    original,
    [{ type: "update_wall", wallId: "receiver", thickness: 160 }],
    "user",
  );
  const footprints = wallFootprints(updated.plan.walls);
  near(
    surface(
      polygonClipping.intersection(footprints.receiver, footprints.branch),
    ),
    0,
  );
  assert.deepEqual(
    updated.plan.walls.find((w) => w.id === "branch"),
    branch,
  );
});
