import type { Plan, Wall } from "./schema";
import { deriveRooms } from "./geometry";
import { catalog } from "./catalog";
export function demoPlan(): Plan {
  const w = (
    id: string,
    a: [number, number],
    b: [number, number],
    kind: Wall["kind"] = "partition",
    thickness = 120,
  ): Wall => ({ id, a, b, kind, thickness, height: 2800, reviewed: false });
  const p: Plan = {
    units: "mm",
    boundary: [
      [0, 0],
      [12000, 0],
      [12000, 9000],
      [0, 9000],
    ],
    walls: [
      w("ext_n", [120, 120], [11880, 120], "exterior", 240),
      w("ext_e", [11880, 120], [11880, 8880], "exterior", 240),
      w("ext_s", [11880, 8880], [120, 8880], "exterior", 240),
      w("ext_w", [120, 8880], [120, 120], "exterior", 240),
      w("bedroom_wall", [4400, 240], [4400, 4500], "bearing", 200),
      w("middle", [240, 4500], [11760, 4500]),
      w("bath_wall", [7800, 240], [7800, 4500]),
      w("kitchen_wall", [8000, 4500], [8000, 8760]),
    ],
    openings: [
      {
        id: "win_bed",
        wallId: "ext_n",
        kind: "window",
        offset: 1000,
        width: 2400,
        height: 1500,
        sill: 800,
        swing: "left",
      },
      {
        id: "win_study",
        wallId: "ext_n",
        kind: "window",
        offset: 4900,
        width: 1800,
        height: 1500,
        sill: 800,
        swing: "left",
      },
      {
        id: "win_bath",
        wallId: "ext_e",
        kind: "window",
        offset: 1300,
        width: 1200,
        height: 1000,
        sill: 1400,
        swing: "left",
      },
      {
        id: "win_living",
        wallId: "ext_s",
        kind: "window",
        offset: 4400,
        width: 4200,
        height: 2100,
        sill: 300,
        swing: "left",
      },
      {
        id: "entry",
        wallId: "ext_w",
        kind: "door",
        offset: 700,
        width: 1000,
        height: 2200,
        sill: 0,
        swing: "left",
      },
      {
        id: "bed_door",
        wallId: "middle",
        kind: "door",
        offset: 3100,
        width: 900,
        height: 2100,
        sill: 0,
        swing: "left",
      },
      {
        id: "study_door",
        wallId: "middle",
        kind: "door",
        offset: 5900,
        width: 900,
        height: 2100,
        sill: 0,
        swing: "right",
      },
      {
        id: "bath_door",
        wallId: "middle",
        kind: "door",
        offset: 8200,
        width: 800,
        height: 2100,
        sill: 0,
        swing: "left",
      },
      {
        id: "kitchen_door",
        wallId: "kitchen_wall",
        kind: "door",
        doorStyle: "sliding",
        offset: 1200,
        width: 1500,
        height: 2200,
        sill: 0,
        swing: "right",
      },
    ],
    rooms: [],
    furniture: [],
  };
  p.rooms = deriveRooms(p);
  const roomNames = ["主卧", "书房", "卫浴", "客餐厅", "厨房"];
  p.rooms.sort(
    (a, b) =>
      Math.min(...a.polygon.map((p) => p[1])) -
        Math.min(...b.polygon.map((p) => p[1])) ||
      Math.min(...a.polygon.map((p) => p[0])) -
        Math.min(...b.polygon.map((p) => p[0])),
  );
  p.rooms.forEach((r, i) => {
    r.name = roomNames[i] ?? r.name;
    r.material = i === 2 || i === 4 ? "tile" : "oak";
  });
  const add = (type: string, x: number, y: number, rotation = 0) => {
    const item = catalog.find((x) => x.type === type)!;
    p.furniture.push({
      ...item,
      id: `demo_${p.furniture.length}`,
      position: [x, y],
      rotation,
    });
  };
  add("bed", 2100, 1700);
  add("nightstand", 850, 1400);
  add("nightstand", 3350, 1400);
  add("wardrobe", 2000, 3900);
  add("desk", 6100, 900);
  add("officechair", 6100, 1600);
  add("bookshelf", 5300, 4000);
  add("plant", 7300, 700);
  add("vanity", 10400, 750);
  add("toilet", 11000, 2000);
  add("shower", 8500, 1000);
  add("rug", 3800, 7000);
  add("sofa", 3700, 8000);
  add("coffee", 3700, 6900);
  add("tv", 3600, 5000);
  add("armchair", 6000, 7200, 270);
  add("plant", 700, 8300);
  add("dining", 10300, 6600, 90);
  add("chair", 9600, 6200);
  add("chair", 11000, 6200);
  add("chair", 9600, 7000);
  add("chair", 11000, 7000);
  add("counter", 10800, 5000);
  add("fridge", 8700, 5200);
  add("sink", 11000, 8200);
  return p;
}
