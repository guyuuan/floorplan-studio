import { z } from "zod";
import {
  wallFaceAttachments,
  wallFaceAttachmentFits,
  followWallFace,
  sameWallEndpoint,
} from "./wall-joints";
import polygonClipping from "polygon-clipping";
import {
  commandSchema,
  planSchema,
  type Command,
  type Project,
  type Snapshot,
  type Wall,
} from "./schema";
import {
  along,
  area,
  deriveRooms,
  furniturePolygon,
  inside,
  wallLength,
  wallFootprints,
  connectWallEndpoints,
  overlappingWall,
} from "./geometry";

export class RuleError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
const fail = (code: string, message: string): never => {
  throw new RuleError(code, message);
};
const snapshot = (p: Project): Snapshot =>
  structuredClone({ plan: p.plan, stage: p.stage, calibrated: p.calibrated });
const userOnly = (actor: "user" | "agent") => {
  if (actor !== "user")
    fail(
      "USER_REVIEW_REQUIRED",
      "墙体类型纠正、比例标定和结构确认必须由用户在网页中完成。",
    );
};
const wallById = (p: Project, id: string) =>
  p.plan.walls.find((w) => w.id === id) ??
  fail("NOT_FOUND", "找不到指定墙体。");
function editable(w: Wall, p: Project) {
  if (w.kind === "exterior")
    fail("EXTERIOR_LOCKED", "外墙及其门窗固定，不能拆改。");
  if (w.kind === "bearing")
    fail("BEARING_LOCKED", "承重墙禁止拆除、移动、修改厚度或开洞。");
  if (w.kind === "unknown" || !w.reviewed)
    fail("UNREVIEWED_WALL", "请先由用户确认该墙为非承重墙。");
  if (p.stage !== "design")
    fail("NOT_IN_DESIGN", "请先完成户型还原和结构核对，再进入设计阶段。");
}
export function validatePlan(plan: unknown) {
  const p = planSchema.parse(plan);
  for (const collection of [p.walls, p.openings, p.rooms, p.furniture]) {
    const ids = collection.map((x) => x.id);
    if (new Set(ids).size !== ids.length)
      fail("DUPLICATE_ID", "同类对象的 ID 不可重复。");
  }
  if (p.walls.length && p.boundary.length < 3)
    fail("BOUNDARY_REQUIRED", "请提供闭合的户型外轮廓。");
  if (p.boundary.length) {
    if (area(p.boundary) < 1e6)
      fail("INVALID_BOUNDARY", "户型面积过小，请检查尺寸。");
    // Every non-adjacent edge pair must be disjoint; self-intersecting footprints are not valid.
    const cross = (a: number[], b: number[], c: number[]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < p.boundary.length; i++)
      for (let j = i + 2; j < p.boundary.length; j++) {
        if (i === 0 && j === p.boundary.length - 1) continue;
        const a = p.boundary[i],
          b = p.boundary[(i + 1) % p.boundary.length],
          c = p.boundary[j],
          d = p.boundary[(j + 1) % p.boundary.length];
        if (
          cross(a, b, c) * cross(a, b, d) <= 0 &&
          cross(c, d, a) * cross(c, d, b) <= 0 &&
          Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
            Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
          Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
            Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
        )
          fail("INVALID_BOUNDARY", "外轮廓不能自相交或重叠。");
      }
  }
  for (const w of p.walls) {
    if (wallLength(w) < 100)
      fail("WALL_TOO_SHORT", "墙体长度不能小于 100 mm。");
  }
  const footprints = wallFootprints(p.walls);
  for (const w of p.walls) {
    const outside = polygonClipping.difference(footprints[w.id], [p.boundary]);
    if (
      outside.reduce((s, poly) => s + area(poly[0] as [number, number][]), 0) >
      10
    )
      fail("OUTSIDE_BOUNDARY", "墙体超出户型外轮廓。");
  }
  for (const o of p.openings) {
    const w =
      p.walls.find((w) => w.id === o.wallId) ??
      fail("ORPHAN_OPENING", "门窗必须依附于有效墙体。");
    if (o.offset + o.width > wallLength(w) + 0.01)
      fail("OPENING_OUT_OF_WALL", "门窗洞口不能超过墙体长度。");
    if (o.sill + o.height > w.height + 0.01)
      fail("OPENING_TOO_HIGH", "门窗洞口不能超过墙高。");
    if (
      p.openings.some(
        (other) =>
          other.id !== o.id &&
          other.wallId === o.wallId &&
          o.offset < other.offset + other.width - 1 &&
          o.offset + o.width > other.offset + 1,
      )
    )
      fail("OVERLAPPING_OPENINGS", "同一墙上的门窗洞口不能重叠。");
  }
  for (const f of p.furniture) {
    if (
      p.boundary.length &&
      furniturePolygon(f).some((c) => !inside(c, p.boundary))
    )
      fail("FURNITURE_OUTSIDE", "家具不能超出户型外轮廓。");
    for (const w of p.walls) {
      const overlap = polygonClipping.intersection(
        [furniturePolygon(f)],
        footprints[w.id],
      );
      if (
        overlap.reduce(
          (s, poly) => s + area(poly[0] as [number, number][]),
          0,
        ) > 100
      )
        fail(
          "FURNITURE_IN_WALL",
          `「${f.name}」与墙体重叠，请调整位置或尺寸。`,
        );
    }
  }
  return p;
}

const descriptions: Record<Command["type"], string> = {
  restore_plan: "提交户型还原",
  calibrate: "标定户型尺寸",
  confirm_structure: "确认户型，进入设计",
  review_walls: "核对全部墙体",
  classify_wall: "纠正墙体类型",
  add_wall: "新建非承重墙",
  update_wall: "调整墙体",
  remove_wall: "拆除墙体",
  upsert_opening: "调整门窗",
  delete_opening: "删除门窗",
  upsert_furniture: "布置家具",
  delete_furniture: "删除家具",
  update_room: "调整房间信息",
  undo: "撤销操作",
  redo: "重做操作",
};
export function applyCommands(
  original: Project,
  raw: unknown[],
  actor: "user" | "agent",
): Project {
  const commands = z.array(commandSchema).min(1).max(100).parse(raw);
  if (
    commands.some((c) => c.type === "undo" || c.type === "redo") &&
    commands.length !== 1
  )
    fail("INVALID_BATCH", "撤销或重做必须单独执行。");
  const p = structuredClone(original),
    before = snapshot(p);
  let geometryChanged = false;
  for (const c of commands) {
    switch (c.type) {
      case "restore_plan":
        if (p.stage !== "reconstruction")
          fail(
            "STRUCTURE_CONFIRMED",
            "设计阶段不能覆盖原始户型，请通过单项编辑操作调整。",
          );
        p.plan = validatePlan(c.plan);
        p.plan.walls.forEach((w) => (w.reviewed = false));
        p.calibrated = false;
        geometryChanged = true;
        break;
      case "calibrate": {
        userOnly(actor);
        if (p.stage !== "reconstruction")
          fail("STRUCTURE_CONFIRMED", "设计阶段不能改变整体比例。");
        const r = c.actualLength / c.measuredLength;
        if (r < 0.001 || r > 1000) fail("INVALID_SCALE", "比例系数超出范围。");
        const pt = (a: [number, number]): [number, number] => [
          a[0] * r,
          a[1] * r,
        ];
        p.plan.boundary = p.plan.boundary.map(pt);
        p.plan.walls.forEach((w) => {
          w.a = pt(w.a);
          w.b = pt(w.b);
          w.thickness *= r;
        });
        p.plan.openings.forEach((o) => {
          o.offset *= r;
          o.width *= r;
        });
        p.plan.rooms.forEach((room) => {
          room.polygon = room.polygon.map(pt);
          room.holes = room.holes.map((h) => h.map(pt));
        });
        p.plan.furniture.forEach((f) => {
          f.position = pt(f.position);
          f.width *= r;
          f.depth *= r;
        });
        p.calibrated = true;
        geometryChanged = true;
        break;
      }
      case "review_walls":
        userOnly(actor);
        if (p.plan.walls.some((w) => w.kind === "unknown"))
          fail("UNKNOWN_WALLS", "还有未分类的墙体，请逐一确认。");
        p.plan.walls.forEach((w) => (w.reviewed = true));
        break;
      case "confirm_structure":
        userOnly(actor);
        if (!p.calibrated) fail("SCALE_REQUIRED", "请先核对或标定实际尺寸。");
        if (
          !p.plan.walls.length ||
          !p.plan.walls.some((w) => w.kind === "exterior") ||
          p.plan.walls.some((w) => !w.reviewed || w.kind === "unknown")
        )
          fail("REVIEW_REQUIRED", "请核对外墙，并确认所有墙体类型。");
        p.stage = "design";
        break;
      case "classify_wall": {
        userOnly(actor);
        const w = wallById(p, c.wallId);
        w.kind = c.kind;
        w.reviewed = c.kind !== "unknown";
        break;
      }
      case "add_wall": {
        if (p.stage !== "design") fail("NOT_IN_DESIGN", "请先确认还原户型。");
        if (c.wall.kind !== "partition")
          fail("PARTITION_ONLY", "设计阶段只能新建非承重内墙。");
        if (p.plan.walls.some((w) => w.id === c.wall.id))
          fail("DUPLICATE_ID", "同类对象的 ID 不可重复。");
        if (wallLength(c.wall) < 100)
          fail("WALL_TOO_SHORT", "墙体长度不能小于 100 mm。");
        const added = connectWallEndpoints(
          { ...c.wall, reviewed: true },
          p.plan.walls,
        );
        const conflict = overlappingWall(added, p.plan.walls);
        if (conflict)
          fail(
            "WALL_INTERSECTION",
            `新墙与墙体 ${conflict.id} 相交或重叠，请将端点接到墙面，不要穿过现有墙体。`,
          );
        p.plan.walls.push(added);
        geometryChanged = true;
        break;
      }
      case "update_wall": {
        const w = wallById(p, c.wallId);
        editable(w, p);
        const originalWalls = structuredClone(p.plan.walls),
          previous = structuredClone(w);
        const thicknessChanged =
          c.thickness !== undefined && c.thickness !== previous.thickness;
        const attachments = thicknessChanged
          ? wallFaceAttachments(previous, originalWalls)
          : [];
        for (const k of ["a", "b", "thickness", "height"] as const)
          if (c[k] !== undefined) Object.assign(w, { [k]: c[k] });
        const requestedStart = [...w.a] as [number, number],
          requestedLength = wallLength(w);
        const direction = requestedLength
          ? [
              (w.b[0] - w.a[0]) / requestedLength,
              (w.b[1] - w.a[1]) / requestedLength,
            ]
          : [0, 0];
        if (requestedLength < 100)
          fail("WALL_TOO_SHORT", "墙体长度不能小于 100 mm。");
        const connected = connectWallEndpoints(w, p.plan.walls);
        if (
          thicknessChanged &&
          sameWallEndpoint(w.a, previous.a) &&
          sameWallEndpoint(w.b, previous.b)
        ) {
          const lateralShift =
            (connected.a[0] - w.a[0]) * -direction[1] +
            (connected.a[1] - w.a[1]) * direction[0];
          if (Math.abs(lateralShift) > 0.05)
            fail(
              "WALL_JOIN_CONFLICT",
              "此转角无法在保持墙体中心线位置的同时改变厚度，请先调整转角连接。",
            );
        }
        const shift =
          (connected.a[0] - requestedStart[0]) * direction[0] +
          (connected.a[1] - requestedStart[1]) * direction[1];
        Object.assign(w, connected);
        for (const opening of p.plan.openings)
          if (opening.wallId === w.id) opening.offset -= shift;
        const affected = new Set([w.id]);
        for (const attachment of attachments) {
          const branch = wallById(p, attachment.wallId);
          const moved =
            followWallFace(w, branch, attachment) ??
            fail(
              "WALL_JOIN_CONFLICT",
              `墙厚联动后，墙体 ${branch.id} 无法保持有效长度或完整贴合，请调整连接。`,
            );
          if (
            sameWallEndpoint(branch.a, moved.a) &&
            sameWallEndpoint(branch.b, moved.b)
          )
            continue;
          if (branch.kind !== "partition" || !branch.reviewed)
            fail(
              "CONNECTED_WALL_LOCKED",
              `墙厚变化需要移动相连墙体 ${branch.id} 的端点，但该墙体受保护或尚未确认，操作未保存。`,
            );
          const size = wallLength(branch),
            startShift =
              ((moved.a[0] - branch.a[0]) * (branch.b[0] - branch.a[0]) +
                (moved.a[1] - branch.a[1]) * (branch.b[1] - branch.a[1])) /
              size;
          Object.assign(branch, moved);
          for (const opening of p.plan.openings) {
            if (opening.wallId !== branch.id) continue;
            const offset = opening.offset - startShift;
            if (
              offset < -0.01 ||
              offset + opening.width > wallLength(branch) + 0.01
            )
              fail(
                "WALL_JOIN_OPENING_CONFLICT",
                `墙厚联动会挤占墙体 ${branch.id} 上的门窗 ${opening.id}，请先调整门窗，操作未保存。`,
              );
            opening.offset = Math.abs(offset) < 0.01 ? 0 : offset;
          }
          affected.add(branch.id);
        }
        // Endpoint shifts must not detach a wall from another face or invalidate an existing branch junction.
        if (thicknessChanged)
          for (const oldHost of originalWalls) {
            for (const attachment of wallFaceAttachments(
              oldHost,
              originalWalls,
            )) {
              if (!affected.has(oldHost.id) && !affected.has(attachment.wallId))
                continue;
              if (
                !wallFaceAttachmentFits(
                  wallById(p, oldHost.id),
                  wallById(p, attachment.wallId),
                  attachment,
                )
              )
                fail(
                  "WALL_JOIN_CONFLICT",
                  `墙厚联动会破坏墙体 ${oldHost.id} 与 ${attachment.wallId} 的既有接缝，操作未保存。`,
                );
            }
          }
        for (const id of affected) {
          const conflict = overlappingWall(wallById(p, id), p.plan.walls);
          if (conflict)
            fail(
              "WALL_INTERSECTION",
              `调整后与墙体 ${conflict.id} 相交或重叠，请调整端点或厚度。`,
            );
        }
        geometryChanged = true;
        break;
      }
      case "remove_wall": {
        const w = wallById(p, c.wallId);
        editable(w, p);
        const l = wallLength(w),
          from = c.from ?? 0,
          to = c.to ?? l;
        if (from >= to || to > l || from > l)
          fail(
            "INVALID_CUT",
            "拆除范围必须在墙体内，起点小于终点（单位 mm）。",
          );
        if ((from > 0 && from < 100) || (to < l && l - to < 100))
          fail("WALL_TOO_SHORT", "拆除后保留的墙段不能短于 100 mm。");
        p.plan.walls = p.plan.walls.filter((x) => x.id !== w.id);
        const left = from > 0 ? { ...w, b: along(w, from) } : null;
        const right =
          to < l
            ? {
                ...w,
                id: from > 0 ? `${w.id}_s${p.revision}` : w.id,
                a: along(w, to),
              }
            : null;
        if (left) p.plan.walls.push(left);
        if (right) p.plan.walls.push(right);
        p.plan.openings = p.plan.openings.flatMap((o) => {
          if (o.wallId !== w.id) return [o];
          if (o.offset < to && o.offset + o.width > from) return [];
          if (o.offset >= to && right)
            return [{ ...o, wallId: right.id, offset: o.offset - to }];
          return left ? [o] : [];
        });
        geometryChanged = true;
        break;
      }
      case "upsert_opening": {
        const old = p.plan.openings.find((o) => o.id === c.opening.id);
        if (old) editable(wallById(p, old.wallId), p);
        editable(wallById(p, c.opening.wallId), p);
        p.plan.openings = p.plan.openings
          .filter((o) => o.id !== c.opening.id)
          .concat(c.opening);
        break;
      }
      case "delete_opening": {
        const o =
          p.plan.openings.find((o) => o.id === c.openingId) ??
          fail("NOT_FOUND", "找不到门窗。");
        editable(wallById(p, o.wallId), p);
        p.plan.openings = p.plan.openings.filter((x) => x.id !== o.id);
        break;
      }
      case "upsert_furniture":
        if (p.stage !== "design") fail("NOT_IN_DESIGN", "请先完成户型核对。");
        p.plan.furniture = p.plan.furniture
          .filter((f) => f.id !== c.furniture.id)
          .concat(c.furniture);
        break;
      case "delete_furniture":
        p.plan.furniture = p.plan.furniture.filter(
          (f) => f.id !== c.furnitureId,
        );
        break;
      case "update_room": {
        const r =
          p.plan.rooms.find((r) => r.id === c.roomId) ??
          fail("NOT_FOUND", "找不到房间。");
        if (c.name) r.name = c.name;
        if (c.material) r.material = c.material;
        break;
      }
      case "undo":
      case "redo": {
        userOnly(actor);
        const stack = c.type === "undo" ? p.history : p.future,
          other = c.type === "undo" ? p.future : p.history;
        const target = stack.pop() ?? fail("NO_HISTORY", "没有可恢复的操作。");
        other.push(before);
        Object.assign(p, target);
        break;
      }
    }
  }
  p.plan = validatePlan(p.plan);
  if (geometryChanged) p.plan.rooms = deriveRooms(p.plan);
  if (!commands.some((c) => c.type === "undo" || c.type === "redo")) {
    p.history.push(before);
    p.history = p.history.slice(-40);
    p.future = [];
  }
  p.revision++;
  p.updatedAt = new Date().toISOString();
  p.activity.unshift({
    at: p.updatedAt,
    actor,
    text: commands.map((c) => descriptions[c.type]).join(" · "),
  });
  p.activity = p.activity.slice(0, 100);
  return p;
}
