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
export function wallPolygon(w: Wall, extend = false): Point[] {
  const l = wallLength(w),
    dx = (w.b[0] - w.a[0]) / l,
    dy = (w.b[1] - w.a[1]) / l;
  const x = (-dy * w.thickness) / 2,
    y = (dx * w.thickness) / 2,
    e = extend ? w.thickness / 2 : 0;
  return [
    [w.a[0] - dx * e + x, w.a[1] - dy * e + y],
    [w.b[0] + dx * e + x, w.b[1] + dy * e + y],
    [w.b[0] + dx * e - x, w.b[1] + dy * e - y],
    [w.a[0] - dx * e - x, w.a[1] - dy * e - y],
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
  const cutters = plan.walls.map(
    (w) => [wallPolygon(w, true)] as polygonClipping.Polygon,
  );
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
