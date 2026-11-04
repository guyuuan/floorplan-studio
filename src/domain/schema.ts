import { z } from "zod";

const finite = z.number().finite();
const positive = finite.positive();
export const pointSchema = z.tuple([
  finite.min(-100000).max(100000),
  finite.min(-100000).max(100000),
]);
export type Point = z.infer<typeof pointSchema>;
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const wallSchema = z.object({
  id,
  a: pointSchema.describe(
    "墙厚中心线的起点 mm；新墙连接处自动按现有墙面及墙厚贴合",
  ),
  b: pointSchema.describe("墙厚中心线的终点 mm，不是墙体外皮角点"),
  thickness: positive.min(40).max(1200),
  height: positive.min(300).max(6000).default(2800),
  kind: z.enum(["exterior", "bearing", "partition", "unknown"]),
  reviewed: z.boolean().default(false),
});
export const openingSchema = z.object({
  id,
  wallId: id,
  kind: z.enum(["door", "window"]),
  offset: finite.nonnegative(),
  width: positive.min(200).max(6000),
  height: positive.min(200).max(4000).default(2100),
  sill: finite.min(0).max(3000).default(0),
  swing: z.enum(["left", "right"]).default("left"),
});
export const furnitureSchema = z.object({
  id,
  type: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  position: pointSchema,
  width: positive.min(50).max(10000),
  depth: positive.min(50).max(10000),
  height: positive.min(10).max(5000),
  rotation: finite.min(-3600).max(3600).default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const materials = {
  oak: { name: "自然橡木", price: 260, color: "#dac6a6" },
  walnut: { name: "深色胡桃木", price: 340, color: "#aa8868" },
  tile: { name: "暖灰地砖", price: 180, color: "#d8d6cf" },
  marble: { name: "浅色大理石", price: 480, color: "#e6e5df" },
  terrazzo: { name: "水磨石", price: 220, color: "#c5cbbf" },
  carpet: { name: "羊毛地毯", price: 320, color: "#c8b8a6" },
} as const;
export const roomSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  polygon: z.array(pointSchema).min(3).max(2000),
  holes: z.array(z.array(pointSchema).min(3)).default([]),
  material: z
    .enum(["oak", "walnut", "tile", "marble", "terrazzo", "carpet"])
    .default("oak"),
});
export const planSchema = z.object({
  units: z.literal("mm").default("mm"),
  boundary: z.array(pointSchema).max(200).default([]),
  walls: z.array(wallSchema).max(500),
  openings: z.array(openingSchema).max(500).default([]),
  rooms: z.array(roomSchema).max(200).default([]),
  furniture: z.array(furnitureSchema).max(1000).default([]),
});
export type Wall = z.infer<typeof wallSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type Furniture = z.infer<typeof furnitureSchema>;
export type Room = z.infer<typeof roomSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Snapshot = {
  plan: Plan;
  stage: "reconstruction" | "design";
  calibrated: boolean;
};
export type Project = Snapshot & {
  schemaVersion: 1;
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  source: null | {
    name: string;
    mime: "image/png" | "image/jpeg" | "image/webp";
    width: number;
    height: number;
  };
  history: Snapshot[];
  future: Snapshot[];
  activity: { at: string; actor: "user" | "agent"; text: string }[];
};

const commands = [
  z.object({ type: z.literal("restore_plan"), plan: planSchema }),
  z.object({
    type: z.literal("calibrate"),
    measuredLength: positive,
    actualLength: positive,
  }),
  z.object({ type: z.literal("confirm_structure") }),
  z.object({ type: z.literal("review_walls") }),
  z.object({
    type: z.literal("classify_wall"),
    wallId: id,
    kind: wallSchema.shape.kind,
  }),
  z.object({ type: z.literal("add_wall"), wall: wallSchema }),
  z.object({
    type: z.literal("update_wall"),
    wallId: id,
    a: pointSchema.optional(),
    b: pointSchema.optional(),
    thickness: wallSchema.shape.thickness.optional(),
    height: wallSchema.shape.height.optional(),
  }),
  z.object({
    type: z.literal("remove_wall"),
    wallId: id,
    from: finite.nonnegative().optional(),
    to: positive.optional(),
  }),
  z.object({ type: z.literal("upsert_opening"), opening: openingSchema }),
  z.object({ type: z.literal("delete_opening"), openingId: id }),
  z.object({ type: z.literal("upsert_furniture"), furniture: furnitureSchema }),
  z.object({ type: z.literal("delete_furniture"), furnitureId: id }),
  z.object({
    type: z.literal("update_room"),
    roomId: id,
    name: z.string().min(1).max(60).optional(),
    material: roomSchema.shape.material.optional(),
  }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
] as const;
export const commandSchema = z.discriminatedUnion("type", commands);
export type Command = z.infer<typeof commandSchema>;
export const batchSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  commands: z.array(commandSchema).min(1).max(100),
});
export const emptyPlan = (): Plan => ({
  units: "mm",
  boundary: [],
  walls: [],
  openings: [],
  rooms: [],
  furniture: [],
});
