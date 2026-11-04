import type { Opening, Wall } from "./schema";
import { wallLength } from "./geometry";

// A conservative application heuristic, not a building-code limit.
export const SINGLE_DOOR_WIDTH = 1200;
export const doorStyleNames = {
  single: "单扇平开门",
  double: "双扇平开门",
  sliding: "推拉门",
  opening: "过道（无门扇）",
} as const;
/** Legacy wide doors remain editable and render as sliding panels instead of one oversized swinging leaf. */
export function doorStyle(opening: Opening): NonNullable<Opening["doorStyle"]> {
  return (
    opening.doorStyle ??
    (opening.width <= SINGLE_DOOR_WIDTH ? "single" : "sliding")
  );
}
export function doorLeafCount(opening: Opening) {
  const style = doorStyle(opening);
  if (style === "opening") return 0;
  if (style === "double") return 2;
  if (style === "sliding")
    return Math.max(2, Math.ceil(opening.width / SINGLE_DOOR_WIDTH));
  return 1;
}

/** Fit a manually added opening to the free wall interval under the pointer. */
export function fitOpening(
  wall: Wall,
  openings: Opening[],
  offset: number,
  kind: Opening["kind"],
) {
  const length = wallLength(wall),
    gaps: [number, number][] = [];
  let cursor = 0;
  for (const opening of openings
    .filter((o) => o.wallId === wall.id)
    .sort((a, b) => a.offset - b.offset)) {
    gaps.push([cursor, opening.offset]);
    cursor = Math.max(cursor, opening.offset + opening.width);
  }
  gaps.push([cursor, length]);
  const gap = gaps.find(([a, b]) => offset >= a && offset <= b && b - a >= 200);
  if (!gap) return null;
  const width = Math.min(
    kind === "door" ? 900 : 1200,
    Math.floor(gap[1] - gap[0]),
  );
  const sill = kind === "door" ? 0 : Math.min(900, wall.height - 200);
  return {
    offset: Math.max(gap[0], Math.min(offset - width / 2, gap[1] - width)),
    width,
    height: Math.min(kind === "door" ? 2100 : 1400, wall.height - sill),
    sill,
    swing: "left" as const,
  };
}

export type OpeningType = Opening["kind"] | "passage";
export function getOpeningType(opening: Opening): OpeningType {
  return opening.kind === "door" && opening.doorStyle === "opening"
    ? "passage"
    : opening.kind;
}
/** A passage retains the opening and removes the leaf; deleting an opening fills the wall instead. */
export function withOpeningType(opening: Opening, type: OpeningType): Opening {
  if (type === "passage")
    return { ...opening, kind: "door", doorStyle: "opening", sill: 0 };
  return {
    ...opening,
    kind: type,
    doorStyle:
      type === "door" && opening.doorStyle !== "opening"
        ? opening.doorStyle
        : undefined,
  };
}
