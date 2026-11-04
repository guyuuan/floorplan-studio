import type { Point, Wall } from "./schema";
import { length } from "./geometry";

/** Endpoint snapping must never change the axis selected from the actual pointer direction. */
export function drawingPoint(
  point: Point,
  origin: Point | null,
  shift: boolean,
  walls: Wall[],
  zoom: number,
): Point {
  let snapped: Point = [
    Math.round(point[0] / 10) * 10,
    Math.round(point[1] / 10) * 10,
  ];
  const endpoint = walls
    .flatMap((w) => [w.a, w.b])
    .find((p) => length(p, snapped) < 100 / zoom);
  if (endpoint) snapped = [...endpoint];
  if (!origin || !shift) return snapped;
  return Math.abs(point[0] - origin[0]) > Math.abs(point[1] - origin[1])
    ? [snapped[0], origin[1]]
    : [origin[0], snapped[1]];
}
