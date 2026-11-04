import polygonClipping from "polygon-clipping";
import type { Plan, Point, Room, Wall, Furniture } from "./schema";

export const length = (a: Point, b: Point) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
export const wallLength = (w: Wall) => length(w.a, w.b);
export function along(w: Wall, distance: number): Point {
  const l = wallLength(w);
  return [
    w.a[0] + ((w.b[0] - w.a[0]) * distance) / l,
    w.a[1] + ((w.b[1] - w.a[1]) * distance) / l,
  ];
}
export function wallPolygon(w: Wall): Point[] {
  const l = wallLength(w),
    dx = (w.b[0] - w.a[0]) / l,
    dy = (w.b[1] - w.a[1]) / l;
  const x = (-dy * w.thickness) / 2,
    y = (dx * w.thickness) / 2;
  return [
    [w.a[0] + x, w.a[1] + y],
    [w.b[0] + x, w.b[1] + y],
    [w.b[0] - x, w.b[1] - y],
    [w.a[0] - x, w.a[1] - y],
  ];
}
export function area(p: Point[]): number {
  return (
    Math.abs(
      p.reduce((s, a, i) => {
        const b = p[(i + 1) % p.length];
        return s + a[0] * b[1] - b[0] * a[1];
      }, 0),
    ) / 2
  );
}
export function centroid(p: Point[]): Point {
  let s = 0,
    x = 0,
    y = 0;
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length],
      q = a[0] * b[1] - b[0] * a[1];
    s += q;
    x += (a[0] + b[0]) * q;
    y += (a[1] + b[1]) * q;
  });
  return Math.abs(s) < 1e-6 ? p[0] : [x / (3 * s), y / (3 * s)];
}
export function inside(p: Point, poly: Point[]): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
export function distanceToWall(p: Point, w: Wall) {
  const l = wallLength(w),
    dx = (w.b[0] - w.a[0]) / l,
    dy = (w.b[1] - w.a[1]) / l;
  const t = Math.max(
    0,
    Math.min(l, (p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy),
  );
  return { distance: length(p, along(w, t)), offset: t };
}

export type WallFootprint = polygonClipping.MultiPolygon;
const JOIN_EPS = 0.05;
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const plus = (a: Point, b: Point, scale = 1): Point => [
  a[0] + b[0] * scale,
  a[1] + b[1] * scale,
];
function lineHit(p: Point, direction: Point, q: Point, edge: Point) {
  const determinant = cross(direction, edge);
  if (Math.abs(determinant) < 1e-8) return null;
  const delta = minus(q, p),
    t = cross(delta, edge) / determinant,
    u = cross(delta, direction) / determinant;
  return { point: plus(p, direction, t), t, u };
}
function segmentDistance(p: Point, a: Point, b: Point) {
  const ab = minus(b, a),
    size = dot(ab, ab);
  const t = size ? Math.max(0, Math.min(1, dot(minus(p, a), ab) / size)) : 0;
  return length(p, plus(a, ab, t));
}
/** Centerline-based outline: square free caps, mitered L joints and bevelled caps at a receiving wall face. */
export function wallOutline(wall: Wall, walls: Wall[]): Point[] {
  const polygon = wallPolygon(wall),
    size = wallLength(wall);
  if (size < 1e-6) return polygon;
  const direction: Point = [
    (wall.b[0] - wall.a[0]) / size,
    (wall.b[1] - wall.a[1]) / size,
  ];
  for (const end of [0, 1] as const) {
    const point = end ? wall.b : wall.a,
      away: Point = end ? [-direction[0], -direction[1]] : direction;
    const neighbours = walls.filter(
      (other) =>
        other.id !== wall.id &&
        (length(point, other.a) < JOIN_EPS ||
          length(point, other.b) < JOIN_EPS),
    );
    for (const side of [1, -1]) {
      const index = end ? (side === 1 ? 1 : 2) : side === 1 ? 0 : 3;
      let corner: Point | null = null;
      if (neighbours.length === 1) {
        const other = neighbours[0],
          far = length(point, other.a) < JOIN_EPS ? other.b : other.a,
          otherSize = length(point, far);
        if (otherSize > 0) {
          const outward: Point = [
            (far[0] - point[0]) / otherSize,
            (far[1] - point[1]) / otherSize,
          ];
          const sideAtNode = side * (end ? -1 : 1);
          const otherEdge = plus(
            point,
            [-outward[1], outward[0]],
            (-sideAtNode * other.thickness) / 2,
          );
          const intersection = lineHit(
            polygon[index],
            direction,
            otherEdge,
            outward,
          );
          if (
            intersection &&
            length(point, intersection.point) <=
              4 * Math.max(wall.thickness, other.thickness)
          )
            corner = intersection.point;
        }
      }
      if (!corner) {
        for (const other of walls) {
          if (other.id === wall.id) continue;
          const outline = wallPolygon(other);
          for (let i = 0; i < outline.length; i++) {
            const a = outline[i],
              b = outline[(i + 1) % outline.length];
            if (
              segmentDistance(point, a, b) > JOIN_EPS ||
              inside(plus(point, away, 1), outline)
            )
              continue;
            const intersection = lineHit(
              polygon[index],
              direction,
              a,
              minus(b, a),
            );
            if (
              intersection &&
              intersection.u >= -1e-6 &&
              intersection.u <= 1 + 1e-6 &&
              length(point, intersection.point) <=
                4 * Math.max(wall.thickness, other.thickness)
            ) {
              corner = intersection.point;
              break;
            }
          }
          if (corner) break;
        }
      }
      if (corner) polygon[index] = corner;
    }
  }
  return polygon;
}
const wallPriority = (wall: Wall) =>
  ({ exterior: 0, bearing: 1, unknown: 2, partition: 3 })[wall.kind];
/** Give every piece of a junction to exactly one wall; all consumers use these same non-overlapping solids. */
export function wallFootprints(walls: Wall[]): Record<string, WallFootprint> {
  const result: Record<string, WallFootprint> = {},
    previous: Point[][] = [];
  const box = (polygon: Point[]) => [
    Math.min(...polygon.map((p) => p[0])),
    Math.min(...polygon.map((p) => p[1])),
    Math.max(...polygon.map((p) => p[0])),
    Math.max(...polygon.map((p) => p[1])),
  ];
  const boxes: number[][] = [];
  for (const wall of [...walls].sort(
    (a, b) => wallPriority(a) - wallPriority(b),
  )) {
    const outline = wallOutline(wall, walls),
      bounds = box(outline);
    const cutters = previous.filter(
      (_, i) =>
        !(
          bounds[0] >= boxes[i][2] ||
          bounds[2] <= boxes[i][0] ||
          bounds[1] >= boxes[i][3] ||
          bounds[3] <= boxes[i][1]
        ),
    );
    result[wall.id] = cutters.length
      ? polygonClipping.difference([outline], ...cutters.map((p) => [p]))
      : [[outline]];
    previous.push(outline);
    boxes.push(bounds);
  }
  return result;
}
/** Snap both centerline endpoints to actual receiving faces, preserving the drawn axis when aligning a corner. */
export function connectWallEndpoints(
  wall: Wall,
  walls: Wall[],
  tolerance = 80,
): Wall {
  const connected = structuredClone(wall),
    others = walls.filter((other) => other.id !== wall.id);
  const outlines = others.map((other) => ({
    wall: other,
    outline: wallOutline(other, others),
  }));
  for (let pass = 0; pass < 2; pass++) {
    for (const end of ["a", "b"] as const) {
      const opposite = end === "a" ? "b" : "a",
        point = connected[end],
        size = wallLength(connected);
      if (size < 100) continue;
      const direction: Point = [
        (connected[opposite][0] - point[0]) / size,
        (connected[opposite][1] - point[1]) / size,
      ];
      let best: { point: Point; shift: Point; distance: number } | null = null;
      for (const host of outlines) {
        if (
          !inside(point, host.outline) &&
          Math.min(
            ...host.outline.map((a, i) =>
              segmentDistance(
                point,
                a,
                host.outline[(i + 1) % host.outline.length],
              ),
            ),
          ) > tolerance
        )
          continue;
        const hits = host.outline
          .flatMap((a, i) => {
            const b = host.outline[(i + 1) % host.outline.length],
              hit = lineHit(point, direction, a, minus(b, a));
            return hit && hit.u >= -1e-6 && hit.u <= 1 + 1e-6
              ? [{ ...hit, a, b }]
              : [];
          })
          .sort((a, b) => b.t - a.t);
        const hit = hits[0];
        if (
          !hit ||
          Math.abs(hit.t) > Math.max(tolerance, host.wall.thickness * 4) ||
          hit.t > size - 100
        )
          continue;
        const edgeLength = length(hit.a, hit.b),
          edge: Point = [
            (hit.b[0] - hit.a[0]) / edgeLength,
            (hit.b[1] - hit.a[1]) / edgeLength,
          ];
        const sine = Math.abs(cross(direction, edge)),
          margin = connected.thickness / (2 * sine);
        if (sine < 0.01 || edgeLength < margin * 2) continue;
        const at = hit.u * edgeLength,
          clamped = Math.max(margin, Math.min(edgeLength - margin, at));
        const target = plus(hit.a, edge, clamped),
          delta = minus(target, hit.point),
          normal: Point = [-direction[1], direction[0]];
        const shift = plus([0, 0], normal, dot(delta, normal));
        if (length([0, 0], shift) > tolerance + connected.thickness / 2)
          continue;
        if (!best || Math.abs(hit.t) < best.distance)
          best = { point: target, shift, distance: Math.abs(hit.t) };
      }
      if (best) {
        connected.a = plus(connected.a, best.shift);
        connected.b = plus(connected.b, best.shift);
        connected[end] = best.point;
      }
    }
  }
  return connected;
}
/** Reject new crossings, duplicate/parallel overlaps and edits that would intrude into another wall. */
export function overlappingWall(wall: Wall, walls: Wall[]): Wall | undefined {
  const others = walls.filter((other) => other.id !== wall.id),
    all = [...others, wall],
    outline = wallOutline(wall, all);
  return others.find((other) => {
    // An existing branch ending on this axis is a T junction, not an interior/interior crossing.
    // Shared footprints trim the branch/host seam without rewriting a protected neighbour.
    const u = minus(wall.b, wall.a),
      v = minus(other.b, other.a);
    const nonParallel =
      Math.abs(cross(u, v)) > wallLength(wall) * wallLength(other) * 0.01;
    if (
      nonParallel &&
      [other.a, other.b].some((point) => {
        const hit = distanceToWall(point, wall);
        return (
          hit.distance < JOIN_EPS &&
          hit.offset > JOIN_EPS &&
          hit.offset < wallLength(wall) - JOIN_EPS
        );
      })
    )
      return false;
    return (
      polygonClipping
        .intersection([outline], [wallOutline(other, all)])
        .reduce(
          (sum, polygon) =>
            sum +
            area(polygon[0] as Point[]) -
            polygon
              .slice(1)
              .reduce((holes, ring) => holes + area(ring as Point[]), 0),
          0,
        ) > 1
    );
  });
}

export function furniturePolygon(f: Furniture): Point[] {
  const r = (f.rotation * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  return [
    [-f.width / 2, -f.depth / 2],
    [f.width / 2, -f.depth / 2],
    [f.width / 2, f.depth / 2],
    [-f.width / 2, f.depth / 2],
  ].map(
    ([x, y]) =>
      [f.position[0] + x * c - y * s, f.position[1] + x * s + y * c] as Point,
  );
}
export function bounds(plan: Plan) {
  const pts = [...plan.boundary, ...plan.walls.flatMap((w) => [w.a, w.b])];
  if (!pts.length) return { x: 0, y: 0, width: 10000, height: 8000 };
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x || 10000,
    height: Math.max(...ys) - y || 8000,
  };
}
export const roomArea = (r: Room) =>
  (area(r.polygon) - r.holes.reduce((s, p) => s + area(p), 0)) / 1e6;
export function deriveRooms(plan: Plan): Room[] {
  if (plan.boundary.length < 3) return [];
  const cutters = Object.values(wallFootprints(plan.walls));
  const result = cutters.length
    ? polygonClipping.difference([plan.boundary], ...cutters)
    : [[plan.boundary]];
  const used = new Set<string>();
  return result
    .filter((p) => area(p[0] as Point[]) > 100000)
    .map((p, i) => {
      const polygon = p[0] as Point[],
        holes = p.slice(1) as Point[][];
      const prior = plan.rooms.find(
        (r) =>
          !used.has(r.id) &&
          inside(centroid(r.polygon), polygon) &&
          !holes.some((h) => inside(centroid(r.polygon), h)),
      );
      if (prior) used.add(prior.id);
      return {
        id:
          prior?.id ??
          `room_${i}_${Math.round(centroid(polygon)[0])}_${Math.round(centroid(polygon)[1])}`,
        name: prior?.name ?? `空间 ${i + 1}`,
        material: prior?.material ?? "oak",
        polygon,
        holes,
      };
    });
}
