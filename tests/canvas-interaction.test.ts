import test from "node:test";
import assert from "node:assert/strict";
import { drawingPoint } from "../src/domain/canvas-interaction";
import { connectWallEndpoints } from "../src/domain/geometry";
import type { Point, Wall } from "../src/domain/schema";
const wall = (id: string, a: Point, b: Point): Wall => ({
  id,
  a,
  b,
  thickness: 120,
  height: 2800,
  kind: "partition",
  reviewed: true,
});
test("Shift projects every quadrant to the dominant horizontal or vertical drawing direction", () => {
  const origin: Point = [1000, 1000];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      assert.deepEqual(
        drawingPoint([1000 + sx * 1000, 1000 + sy * 400], origin, true, [], 1),
        [1000 + sx * 1000, 1000],
      );
      assert.deepEqual(
        drawingPoint([1000 + sx * 400, 1000 + sy * 1000], origin, true, [], 1),
        [1000, 1000 + sy * 1000],
      );
    }
});
test("an off-axis endpoint snap cannot override the direction of the actual pointer", () => {
  const walls = [wall("target", [1980, 2020], [4000, 2020])];
  assert.deepEqual(
    drawingPoint([2000, 1950], [1000, 1000], true, walls, 1),
    [1980, 1000],
  );
  assert.deepEqual(
    drawingPoint([2000, 1950], [1000, 1000], false, walls, 1),
    [1980, 2020],
  );
});
test("the Shift-fixed coordinate retains a non-grid start without introducing a diagonal", () => {
  assert.deepEqual(
    drawingPoint([2124, 1458], [1000.25, 1000.75], true, [], 1),
    [2120, 1000.75],
  );
  assert.deepEqual(
    drawingPoint([1458, 2124], [1000.25, 1000.75], true, [], 1),
    [1000.25, 2120],
  );
});
test("re-evaluating the same raw pointer on Shift press and release restores the free diagonal", () => {
  const pointer: Point = [2100, 1600],
    origin: Point = [1000, 1000];
  assert.deepEqual(drawingPoint(pointer, origin, false, [], 1), [2100, 1600]);
  assert.deepEqual(drawingPoint(pointer, origin, true, [], 1), [2100, 1000]);
  assert.deepEqual(drawingPoint(pointer, origin, false, [], 1), [2100, 1600]);
});
test("wall-thickness attachment preserves horizontal and vertical Shift constraints", () => {
  for (const [a, raw] of [
    [
      [3000, 3000],
      [5000, 3400],
    ],
    [
      [3000, 3000],
      [3400, 5000],
    ],
  ] as [Point, Point][]) {
    const host =
      raw[0] > raw[1]
        ? wall("host", [3000, 1000], [3000, 5000])
        : wall("host", [1000, 3000], [5000, 3000]);
    host.thickness = 240;
    const b = drawingPoint(raw, a, true, [host], 1),
      connected = connectWallEndpoints(wall("new", a, b), [host]);
    assert.ok(
      Math.abs(connected.a[0] - connected.b[0]) < 1e-6 ||
        Math.abs(connected.a[1] - connected.b[1]) < 1e-6,
    );
  }
});
