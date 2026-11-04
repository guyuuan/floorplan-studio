import type { Point, Wall } from "./schema";
import { length, wallLength } from "./geometry";

const EPS = 0.05;
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const delta = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
function axis(wall: Wall) {
  const size = wallLength(wall);
  const u: Point = [
    (wall.b[0] - wall.a[0]) / size,
    (wall.b[1] - wall.a[1]) / size,
  ];
  return { u, n: [-u[1], u[0]] as Point, size };
}
export type WallFaceAttachment = {
  wallId: string;
  end: "a" | "b";
  side: 1 | -1;
};
/** Infer actual face contacts before an edit. Nearby detached walls and legacy axis nodes are not face anchors. */
export function wallFaceAttachments(
  host: Wall,
  walls: Wall[],
): WallFaceAttachment[] {
  const frame = axis(host),
    result: WallFaceAttachment[] = [];
  for (const branch of walls) {
    if (branch.id === host.id || wallLength(branch) < 100) continue;
    for (const end of ["a", "b"] as const) {
      const point = branch[end],
        other = branch[end === "a" ? "b" : "a"];
      const offset = delta(point, host.a),
        along = dot(offset, frame.u),
        signed = dot(offset, frame.n);
      if (
        along < -EPS ||
        along > frame.size + EPS ||
        Math.abs(Math.abs(signed) - host.thickness / 2) > EPS
      )
        continue;
      const side = signed > 0 ? 1 : -1;
      // A branch must leave the host solid, rather than pass through it to the other side.
      if (dot(delta(other, point), frame.n) * side <= EPS) continue;
      result.push({ wallId: branch.id, end, side });
    }
  }
  return result;
}
/** Check that the entire sloping end cap still fits the finite receiving face. */
export function wallFaceAttachmentFits(
  host: Wall,
  branch: Wall,
  attachment: WallFaceAttachment,
) {
  const frame = axis(host),
    branchFrame = axis(branch),
    point = branch[attachment.end],
    offset = delta(point, host.a);
  const signed = dot(offset, frame.n),
    along = dot(offset, frame.u),
    sine = Math.abs(dot(branchFrame.u, frame.n));
  if (
    sine < 1e-6 ||
    Math.abs(signed - (attachment.side * host.thickness) / 2) > EPS
  )
    return false;
  const margin = branch.thickness / (2 * sine);
  const other = branch[attachment.end === "a" ? "b" : "a"];
  return (
    along - margin >= -EPS &&
    along + margin <= frame.size + EPS &&
    dot(delta(other, point), frame.n) * attachment.side > EPS
  );
}
/** Move only the attached end along the original branch axis; the opposite end stays fixed. */
export function followWallFace(
  host: Wall,
  branch: Wall,
  attachment: WallFaceAttachment,
): Wall | null {
  const frame = axis(host),
    branchFrame = axis(branch),
    point = branch[attachment.end];
  const denominator = dot(branchFrame.u, frame.n);
  if (Math.abs(denominator) < 1e-6) return null;
  const shift =
    ((attachment.side * host.thickness) / 2 -
      dot(delta(point, host.a), frame.n)) /
    denominator;
  const moved = structuredClone(branch);
  moved[attachment.end] = [
    point[0] + branchFrame.u[0] * shift,
    point[1] + branchFrame.u[1] * shift,
  ];
  // A Euclidean length alone would allow the moving end to pass the fixed end and reverse the wall.
  if (
    dot(delta(moved.b, moved.a), branchFrame.u) < 100 ||
    !wallFaceAttachmentFits(host, moved, attachment)
  )
    return null;
  return moved;
}
export const sameWallEndpoint = (a: Point, b: Point) => length(a, b) < EPS;
