"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  bounds,
  centroid,
  distanceToWall,
  inside,
  roomArea,
  wallLength,
} from "@/domain/geometry";
import { materials, type Furniture, type Plan } from "@/domain/schema";
import type { Selection } from "./PlanCanvas";

function furnitureModel(f: Furniture) {
  const g = new THREE.Group(),
    w = f.width / 1000,
    d = f.depth / 1000,
    h = f.height / 1000;
  const material = (c: string, roughness = 0.8) =>
    new THREE.MeshStandardMaterial({ color: c, roughness });
  const main = material(f.color),
    light = material("#e8e1d2"),
    wood = material("#ad906b"),
    dark = material("#6a7165"),
    metal = material("#92988f", 0.3);
  const box = (
    x: number,
    y: number,
    z: number,
    bw: number,
    bh: number,
    bd: number,
    m = main,
    r = 0.025,
  ) => {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(
        Math.max(bw, 0.01),
        Math.max(bh, 0.01),
        Math.max(bd, 0.01),
        2,
        Math.min(r, bw / 4, bh / 4, bd / 4),
      ),
      m,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const leg = (x: number, z: number, height: number) =>
    box(x, height / 2, z, 0.045, height, 0.045, wood, 0.006);
  const legs = (height: number) => {
    for (const x of [-w * 0.38, w * 0.38])
      for (const z of [-d * 0.37, d * 0.37]) leg(x, z, height);
  };
  const sphere = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    m: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), m);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  if (["plant", "planter"].includes(f.type)) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(w * 0.32, w * 0.23, h * 0.28, 20),
      material("#b3a289"),
    );
    pot.position.y = h * 0.14;
    pot.castShadow = true;
    g.add(pot);
    box(0, h * 0.55, 0, 0.035, h * 0.6, 0.035, wood);
    for (let i = 0; i < 9; i++) {
      const a = (i * Math.PI * 2) / 5,
        r = w * (0.16 + (i % 2) * 0.12),
        y = h * (0.45 + i * 0.055);
      sphere(
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
        w * 0.19,
        h * 0.16,
        w * 0.12,
        material(i % 2 ? "#6d865a" : "#819a68"),
      );
    }
  } else if (["bed", "singlebed", "bunk", "tatami", "crib"].includes(f.type)) {
    box(0, 0.18, 0, w, 0.32, d, wood);
    box(0, 0.4, 0, w * 0.97, 0.22, d * 0.96, light, 0.07);
    box(0, h / 2, -d / 2 + 0.06, w, h, 0.12, main, 0.04);
    box(0, 0.54, d * 0.18, w * 0.98, 0.1, d * 0.6, main, 0.05);
    box(-w * 0.24, 0.57, -d * 0.3, w * 0.41, 0.13, d * 0.22, light, 0.05);
    box(w * 0.24, 0.57, -d * 0.3, w * 0.41, 0.13, d * 0.22, light, 0.05);
    if (f.type === "bunk") {
      box(0, 1.45, 0, w, 0.18, d, wood);
      box(0, 1.6, 0, w, 0.12, d, light);
      for (const x of [-w * 0.46, w * 0.46])
        for (const z of [-d * 0.46, d * 0.46])
          box(x, 0.9, z, 0.07, 1.8, 0.07, wood);
    }
  } else if (["sofa", "loveseat", "armchair", "lounge"].includes(f.type)) {
    legs(0.12);
    box(0, 0.25, 0, w, 0.3, d);
    box(0, h * 0.66, -d * 0.39, w, h * 0.68, d * 0.22);
    box(-w * 0.45, h * 0.46, 0, w * 0.12, h * 0.65, d);
    box(w * 0.45, h * 0.46, 0, w * 0.12, h * 0.65, d);
    const n = f.type === "sofa" ? 3 : f.type === "loveseat" ? 2 : 1;
    for (let i = 0; i < n; i++) {
      box(
        -w * 0.36 + ((i + 0.5) * w * 0.72) / n,
        0.48,
        d * 0.06,
        (w * 0.7) / n,
        0.17,
        d * 0.65,
        light,
        0.06,
      );
      box(
        -w * 0.36 + ((i + 0.5) * w * 0.72) / n,
        h * 0.68,
        -d * 0.25,
        (w * 0.68) / n,
        h * 0.35,
        0.15,
        main,
        0.05,
      );
    }
  } else if (f.type === "rug") {
    box(0, 0.012, 0, w, 0.024, d, main, 0.02);
  } else if (
    [
      "dining",
      "coffee",
      "desk",
      "roundtable",
      "roundcoffee",
      "smalltable",
      "balconytable",
      "console",
      "bar",
      "bench",
    ].includes(f.type)
  ) {
    legs(h - 0.07);
    if (f.type.startsWith("round") || f.type === "balconytable") {
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(w / 2, w / 2, 0.07, 40),
        main,
      );
      top.position.y = h - 0.035;
      top.scale.z = d / w;
      top.castShadow = true;
      g.add(top);
    } else box(0, h - 0.04, 0, w, 0.08, d);
    if (f.type === "desk")
      box(-w * 0.32, h * 0.48, 0, w * 0.25, h * 0.8, d * 0.9);
  } else if (
    ["chair", "officechair", "foldchair", "barstool"].includes(f.type)
  ) {
    legs(h * 0.48);
    box(0, h * 0.49, 0, w, 0.08, d);
    box(0, h * 0.77, -d * 0.42, w, h * 0.45, 0.09);
  } else if (
    [
      "wardrobe",
      "bookshelf",
      "cabinet",
      "tallcabinet",
      "sideboard",
      "shelf",
      "shoe",
    ].includes(f.type)
  ) {
    box(0, h / 2, 0, w, h, d);
    const count = Math.max(2, Math.round(w / 0.55));
    for (let i = 1; i < count; i++)
      box(
        -w / 2 + (i * w) / count,
        h / 2,
        d / 2 + 0.003,
        0.008,
        h * 0.97,
        0.008,
        dark,
        0.001,
      );
    if (f.type === "bookshelf" || f.type === "shelf") {
      for (let y = 0.35; y < h; y += 0.4) {
        box(0, y, d * 0.15, w * 0.92, 0.025, d * 0.8, wood);
        for (let i = 0; i < 5; i++)
          box(
            -w * 0.32 + i * w * 0.12,
            y + 0.13,
            d * 0.3,
            0.06,
            0.24,
            0.12,
            material(["#9d9d7b", "#c1b59c", "#849182"][i % 3]),
          );
      }
    } else
      for (let i = 0; i < count; i++)
        box(
          -w / 2 + ((i + 0.8) * w) / count,
          h * 0.52,
          d / 2 + 0.025,
          0.025,
          0.16,
          0.025,
          metal,
          0.008,
        );
  } else if (["toilet"].includes(f.type)) {
    box(0, h * 0.65, -d * 0.3, w * 0.88, h * 0.65, d * 0.28, light, 0.07);
    sphere(0, h * 0.37, d * 0.12, w * 0.48, h * 0.3, d * 0.4, light);
    sphere(
      0,
      h * 0.58,
      d * 0.12,
      w * 0.35,
      0.018,
      d * 0.27,
      material("#ced7cd"),
    );
  } else if (["sink", "vanity", "laundry"].includes(f.type)) {
    box(0, h * 0.47, 0, w, h * 0.94, d);
    box(0, h, 0, w * 1.03, 0.055, d * 1.03, light);
    box(0, h + 0.03, 0, w * 0.55, 0.025, d * 0.65, material("#a6b6ac"));
    box(0, h + 0.12, -d * 0.33, 0.025, 0.22, 0.025, metal);
    box(0, h + 0.22, -d * 0.19, 0.025, 0.025, d * 0.3, metal);
  } else if (f.type === "shower") {
    box(0, 0.035, 0, w, 0.07, d, light);
    const glass = new THREE.MeshPhysicalMaterial({
      color: "#b7d5c8",
      transparent: true,
      opacity: 0.23,
      roughness: 0.1,
      side: THREE.DoubleSide,
    });
    box(-w / 2, h / 2, 0, 0.025, h, d, glass);
    box(0, h / 2, -d / 2, w, h, 0.025, glass);
    box(w * 0.3, h * 0.7, -d * 0.4, 0.025, h * 0.5, 0.025, metal);
    box(w * 0.3, h * 0.94, -d * 0.28, 0.13, 0.025, 0.15, metal);
  } else if (f.type === "bathtub" || f.type === "tubround") {
    box(0, h / 2, 0, w, h, d, light, 0.2);
    box(0, h + 0.005, 0, w * 0.85, 0.03, d * 0.7, material("#cad9d1"), 0.12);
  } else if (
    ["fridge", "washer", "dryer", "oven", "dishwasher", "ac"].includes(f.type)
  ) {
    box(0, h / 2, 0, w, h, d);
    if (f.type === "washer" || f.type === "dryer") {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(w * 0.3, 0.035, 12, 40),
        metal,
      );
      ring.position.set(0, h * 0.46, d / 2 + 0.01);
      g.add(ring);
      const circle = new THREE.Mesh(
        new THREE.CircleGeometry(w * 0.26, 32),
        dark,
      );
      circle.position.set(0, h * 0.46, d / 2 + 0.015);
      g.add(circle);
    } else {
      box(w * 0.31, h * 0.65, d / 2 + 0.025, 0.025, h * 0.28, 0.03, metal);
      box(0, h * 0.65, d / 2 + 0.003, w * 0.98, 0.009, 0.006, dark);
    }
  } else if (f.type === "floorlamp") {
    box(0, 0.02, 0, w, 0.04, d, metal);
    box(0, h / 2, 0, 0.025, h, 0.025, metal);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.6, h * 0.23, 24, 1, true),
      light,
    );
    shade.rotation.z = Math.PI;
    shade.position.y = h * 0.88;
    g.add(shade);
  } else {
    box(0, h / 2, 0, w, h, d);
  }
  g.position.set(f.position[0] / 1000, 0, f.position[1] / 1000);
  g.rotation.y = (-f.rotation * Math.PI) / 180;
  g.userData.furnitureId = f.id;
  g.traverse((o) => (o.userData.furnitureId = f.id));
  return g;
}

type Props = {
  plan: Plan;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onMove: (f: Furniture) => void;
  cut: boolean;
  time: number;
  walk: boolean;
  view: "orbit" | "top" | "angle";
  focusRoom: string | null;
};
export function SceneCanvas({
  plan,
  selection,
  onSelect,
  onMove,
  cut,
  time,
  walk,
  view,
  focusRoom,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    cameraState = useRef<{
      position: THREE.Vector3;
      target: THREE.Vector3;
    } | null>(null),
    callbacks = useRef({ onSelect, onMove }),
    selectionRef = useRef(selection),
    [error, setError] = useState("");
  callbacks.current = { onSelect, onMove };
  selectionRef.current = selection;
  useEffect(() => {
    if (!host.current) return;
    const container = host.current,
      b = bounds(plan),
      cx = (b.x + b.width / 2) / 1000,
      cz = (b.y + b.height / 2) / 1000;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError("此浏览器无法启用 WebGL，请切换到 2D 或启用硬件加速。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.setAttribute("data-three-export", "true");
    renderer.domElement.setAttribute("aria-label", "Three.js 3D 户型场景");
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(
      time < 6 || time > 19 ? "#26382f" : "#edf0e8",
    );
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    camera.position.set(cx + 11, 13, cz + 13);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(cx, 0, cz);
    orbit.enableDamping = true;
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.minDistance = 2;
    orbit.maxDistance = 40;
    if (cameraState.current) {
      camera.position.copy(cameraState.current.position);
      orbit.target.copy(cameraState.current.target);
    }
    const pointer = new PointerLockControls(camera, renderer.domElement);
    if (walk) {
      const room = [...plan.rooms].sort((a, b) => roomArea(b) - roomArea(a))[0];
      const spawn = room ? centroid(room.polygon) : [cx * 1000, cz * 1000];
      camera.position.set(spawn[0] / 1000, 1.65, spawn[1] / 1000);
      camera.lookAt(spawn[0] / 1000 + 1, 1.65, spawn[1] / 1000);
      orbit.enabled = false;
    }
    if (view === "top" && !walk) {
      camera.position.set(cx, 20, cz + 0.01);
      orbit.target.set(cx, 0, cz);
    }
    if (view === "angle" && !walk) {
      camera.position.set(cx + 10, 10, cz + 12);
      orbit.target.set(cx, 0, cz);
    }
    if (focusRoom && !walk) {
      const r = plan.rooms.find((r) => r.id === focusRoom);
      if (r) {
        const xs = r.polygon.map((p) => p[0] / 1000),
          zs = r.polygon.map((p) => p[1] / 1000),
          x = (Math.min(...xs) + Math.max(...xs)) / 2,
          z = (Math.min(...zs) + Math.max(...zs)) / 2;
        orbit.target.set(x, 0, z);
        camera.position.set(x + 4, 7, z + 5);
      }
    }
    orbit.update();
    scene.add(
      new THREE.HemisphereLight(
        "#f9f7e9",
        "#a1ad96",
        time < 6 || time > 19 ? 0.65 : 2.1,
      ),
    );
    const sun = new THREE.DirectionalLight(
      "#fff0d0",
      time < 6 || time > 19 ? 0.12 : 3.3,
    );
    const angle = ((time - 6) / 12) * Math.PI;
    sun.position.set(
      cx + Math.cos(angle) * 12,
      Math.max(2, Math.sin(angle) * 18),
      cz - 8,
    );
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -15,
      right: 15,
      top: 15,
      bottom: -15,
      near: 0.5,
      far: 50,
    });
    sun.shadow.bias = -0.0003;
    scene.add(sun, sun.target);
    const floorMat = (color: string) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.86,
        side: THREE.DoubleSide,
      });
    const shape = (points: [number, number][]) =>
      new THREE.Shape(
        points.map((p) => new THREE.Vector2(p[0] / 1000, p[1] / 1000)),
      );
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(
        b.width / 1000 + 0.12,
        0.18,
        b.height / 1000 + 0.12,
      ),
      floorMat("#a4ab9a"),
    );
    base.position.set(cx, -0.12, cz);
    base.receiveShadow = true;
    scene.add(base);
    for (const r of plan.rooms) {
      const s = shape(r.polygon);
      r.holes.forEach((h) =>
        s.holes.push(
          new THREE.Path(
            h.map((p) => new THREE.Vector2(p[0] / 1000, p[1] / 1000)),
          ),
        ),
      );
      const floor = new THREE.Mesh(
        new THREE.ShapeGeometry(s),
        floorMat(materials[r.material].color),
      );
      floor.rotation.x = Math.PI / 2;
      floor.position.y = 0.005;
      floor.receiveShadow = true;
      scene.add(floor);
      if (r.material === "oak" || r.material === "walnut") {
        const bb = new THREE.Box2().setFromPoints(
          r.polygon.map((p) => new THREE.Vector2(p[0] / 1000, p[1] / 1000)),
        );
        const lines = new THREE.Group();
        for (let x = bb.min.x; x <= bb.max.x; x += 0.22) {
          const spans: [number, number][] = [];
          const cuts: number[] = [];
          for (let i = 0; i < r.polygon.length; i++) {
            const a = r.polygon[i],
              b = r.polygon[(i + 1) % r.polygon.length],
              xx = x * 1000;
            if (a[0] > xx !== b[0] > xx)
              cuts.push(
                (a[1] + ((b[1] - a[1]) * (xx - a[0])) / (b[0] - a[0])) / 1000,
              );
          }
          cuts.sort((a, b) => a - b);
          for (let i = 0; i + 1 < cuts.length; i += 2)
            spans.push([cuts[i], cuts[i + 1]]);
          for (const [a, b] of spans) {
            const geo = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(x, 0.009, a),
              new THREE.Vector3(x, 0.009, b),
            ]);
            lines.add(
              new THREE.Line(
                geo,
                new THREE.LineBasicMaterial({
                  color: "#aa906b",
                  transparent: true,
                  opacity: 0.16,
                }),
              ),
            );
          }
        }
        scene.add(lines);
      }
      if (walk) {
        const light = new THREE.PointLight(
          "#ffe1b0",
          time < 6 || time > 19 ? 12 : 1.5,
          8,
          2,
        );
        const x =
            r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length / 1000,
          z = r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length / 1000;
        light.position.set(x, 2.65, z);
        scene.add(light);
      }
    }
    const wallMat = new THREE.MeshStandardMaterial({
        color: "#f4f1e6",
        roughness: 0.9,
      }),
      capMat = new THREE.MeshStandardMaterial({
        color: "#77816e",
        roughness: 0.9,
      }),
      frameMat = new THREE.MeshStandardMaterial({
        color: "#9f9f8c",
        roughness: 0.5,
      }),
      doorMat = new THREE.MeshStandardMaterial({
        color: "#baa58a",
        roughness: 0.8,
      }),
      glass = new THREE.MeshPhysicalMaterial({
        color: "#bbd5cc",
        transparent: true,
        opacity: 0.27,
        roughness: 0.1,
        side: THREE.DoubleSide,
      });
    const doorGroups: {
      id: string;
      group: THREE.Group;
      open: boolean;
      angle: number;
      center: THREE.Vector3;
    }[] = [];
    for (const w of plan.walls) {
      const l = wallLength(w) / 1000,
        t = w.thickness / 1000,
        full = w.height / 1000,
        h = cut && !walk ? Math.min(0.95, full) : full,
        ang = -Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
      const group = new THREE.Group();
      group.position.set(w.a[0] / 1000, 0, w.a[1] / 1000);
      group.rotation.y = ang;
      const piece = (
        start: number,
        end: number,
        bottom: number,
        top: number,
        material: THREE.Material = wallMat,
      ) => {
        if (end - start < 0.001 || top - bottom < 0.001) return;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(end - start, top - bottom, t),
          [material, material, capMat, material, material, material],
        );
        m.position.set((start + end) / 2, (bottom + top) / 2, 0);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      };
      const openings = plan.openings
        .filter((o) => o.wallId === w.id)
        .sort((a, b) => a.offset - b.offset);
      let cursor = 0;
      for (const o of openings) {
        const a = o.offset / 1000,
          z = (o.offset + o.width) / 1000;
        piece(cursor, a, 0, h);
        piece(a, z, 0, Math.min(h, o.sill / 1000));
        piece(a, z, Math.max(0, (o.sill + o.height) / 1000), h);
        const oh = Math.min(h, (o.sill + o.height) / 1000) - o.sill / 1000;
        if (oh > 0 && o.kind === "window") {
          const pane = new THREE.Mesh(
            new THREE.BoxGeometry(z - a, oh, 0.025),
            glass,
          );
          pane.position.set((a + z) / 2, o.sill / 1000 + oh / 2, 0);
          group.add(pane);
          for (const x of [a, (a + z) / 2, z]) {
            const bar = new THREE.Mesh(
              new THREE.BoxGeometry(0.035, oh, 0.06),
              frameMat,
            );
            bar.position.set(x, o.sill / 1000 + oh / 2, 0);
            group.add(bar);
          }
        } else if (o.kind === "door" && oh > 0) {
          const hinge = new THREE.Group();
          hinge.position.x = o.swing === "left" ? a : z;
          const panel = new THREE.Mesh(
            new THREE.BoxGeometry(z - a, oh, 0.045),
            doorMat,
          );
          panel.position.set(
            o.swing === "left" ? (z - a) / 2 : -(z - a) / 2,
            oh / 2,
            0,
          );
          panel.castShadow = true;
          panel.userData.doorId = o.id;
          hinge.add(panel);
          hinge.rotation.y =
            o.swing === "left" ? -Math.PI * 0.35 : Math.PI * 0.35;
          group.add(hinge);
          group.updateMatrixWorld(true);
          doorGroups.push({
            id: o.id,
            group: hinge,
            open: true,
            angle: hinge.rotation.y,
            center: new THREE.Vector3(
              (w.a[0] + w.b[0]) / 2000,
              0,
              (w.a[1] + w.b[1]) / 2000,
            ),
          });
        }
        cursor = z;
      }
      piece(cursor, l, 0, h);
      scene.add(group);
    }
    const furniture = new THREE.Group();
    scene.add(furniture);
    plan.furniture.forEach((f) => furniture.add(furnitureModel(f)));
    const selectionBox = new THREE.BoxHelper(furniture, "#4c8a65");
    selectionBox.visible = false;
    scene.add(selectionBox);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      floorMat(time < 6 || time > 19 ? "#25362b" : "#e9ede2"),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.23;
    ground.receiveShadow = true;
    scene.add(ground);
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2(),
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      intersection = new THREE.Vector3();
    let moving: {
      item: Furniture;
      object: THREE.Object3D;
      start: THREE.Vector3;
      original: THREE.Vector3;
    } | null = null;
    let moved = false;
    const rayAt = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, camera);
    };
    const down = (e: PointerEvent) => {
      if (walk) {
        if (e.pointerType !== "touch" && !pointer.isLocked) pointer.lock();
        return;
      }
      if (e.button !== 0) return;
      rayAt(e);
      const hits = ray.intersectObjects(furniture.children, true),
        doorHits = ray
          .intersectObjects(scene.children, true)
          .find((hit) => hit.object.userData.doorId);
      if (doorHits && (!hits[0] || doorHits.distance < hits[0].distance)) {
        const d = doorGroups.find(
          (d) => d.id === doorHits.object.userData.doorId,
        );
        if (d) {
          d.open = !d.open;
          d.group.rotation.y = d.open ? d.angle : 0;
        }
        return;
      }
      if (hits[0]) {
        const id = hits[0].object.userData.furnitureId,
          f = plan.furniture.find((x) => x.id === id),
          object = furniture.children.find(
            (x) => x.userData.furnitureId === id,
          );
        if (f && object && ray.ray.intersectPlane(plane, intersection)) {
          callbacks.current.onSelect({ kind: "furniture", id });
          moving = {
            item: f,
            object,
            start: intersection.clone(),
            original: object.position.clone(),
          };
          orbit.enabled = false;
          moved = false;
          renderer.domElement.setPointerCapture(e.pointerId);
        }
      }
    };
    const move = (e: PointerEvent) => {
      if (!moving) return;
      rayAt(e);
      if (ray.ray.intersectPlane(plane, intersection)) {
        const delta = intersection.clone().sub(moving.start);
        moving.object.position.copy(moving.original).add(delta);
        moved = delta.length() > 0.03;
      }
    };
    const up = () => {
      if (moving && moved)
        callbacks.current.onMove({
          ...moving.item,
          position: [
            Math.round(moving.object.position.x * 100),
            Math.round(moving.object.position.z * 100),
          ].map((v) => v * 10) as [number, number],
        });
      moving = null;
      orbit.enabled = !walk;
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", up);
    const keys = new Set<string>();
    const keydown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      keys.add(e.code);
      if (walk && e.code === "KeyE") {
        let nearest = Infinity,
          target: (typeof doorGroups)[number] | undefined;
        doorGroups.forEach((d) => {
          const world = new THREE.Vector3();
          d.group.getWorldPosition(world);
          const dist = world.distanceTo(camera.position);
          if (dist < nearest) {
            nearest = dist;
            target = d;
          }
        });
        if (target && nearest < 3) {
          target.open = !target.open;
          target.group.rotation.y = target.open ? target.angle : 0;
        }
      }
    };
    const keyup = (e: KeyboardEvent) => keys.delete(e.code);
    const blur = () => keys.clear();
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    let joystick: { x: number; y: number } | null = null;
    const stickDown = (e: PointerEvent) => {
      if (!walk || e.pointerType !== "touch") return;
      joystick = { x: e.clientX, y: e.clientY };
    };
    const stickMove = (e: PointerEvent) => {
      if (!joystick) return;
      keys.delete("KeyW");
      keys.delete("KeyS");
      keys.delete("KeyA");
      keys.delete("KeyD");
      if (e.clientY < joystick.y - 12) keys.add("KeyW");
      if (e.clientY > joystick.y + 12) keys.add("KeyS");
      if (e.clientX < joystick.x - 12) keys.add("KeyA");
      if (e.clientX > joystick.x + 12) keys.add("KeyD");
    };
    const stickUp = () => {
      joystick = null;
      keys.clear();
    };
    container.addEventListener("pointerdown", stickDown);
    container.addEventListener("pointermove", stickMove);
    container.addEventListener("pointerup", stickUp);
    const resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(container);
    let frame = 0,
      prev = performance.now();
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const now = performance.now(),
        dt = Math.min((now - prev) / 1000, 0.04);
      prev = now;
      const selected = selectionRef.current,
        selectedObject =
          selected?.kind === "furniture"
            ? furniture.children.find(
                (o) => o.userData.furnitureId === selected.id,
              )
            : undefined;
      selectionBox.visible = !!selectedObject;
      if (selectedObject) selectionBox.setFromObject(selectedObject);
      if (!walk) orbit.update();
      else {
        const before = camera.position.clone(),
          speed = dt * (keys.has("ShiftLeft") ? 4 : 1.8);
        if (keys.has("KeyW") || keys.has("ArrowUp")) pointer.moveForward(speed);
        if (keys.has("KeyS") || keys.has("ArrowDown"))
          pointer.moveForward(-speed);
        if (keys.has("KeyA") || keys.has("ArrowLeft"))
          pointer.moveRight(-speed);
        if (keys.has("KeyD") || keys.has("ArrowRight"))
          pointer.moveRight(speed);
        const p: [number, number] = [
          camera.position.x * 1000,
          camera.position.z * 1000,
        ];
        let blocked = plan.boundary.length && !inside(p, plan.boundary);
        for (const w of plan.walls) {
          const hit = distanceToWall(p, w);
          if (hit.distance < w.thickness / 2 + 150) {
            const opening = plan.openings.find(
              (o) =>
                o.wallId === w.id &&
                o.kind === "door" &&
                hit.offset > o.offset + 130 &&
                hit.offset < o.offset + o.width - 130,
            );
            const door = opening && doorGroups.find((d) => d.id === opening.id);
            if (!opening || !door?.open) blocked = true;
          }
        }
        if (blocked) camera.position.copy(before);
        camera.position.y = 1.65;
      }
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cameraState.current = {
        position: camera.position.clone(),
        target: orbit.target.clone(),
      };
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      container.removeEventListener("pointerdown", stickDown);
      container.removeEventListener("pointermove", stickMove);
      container.removeEventListener("pointerup", stickUp);
      pointer.dispose();
      orbit.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [plan, cut, time, walk, view, focusRoom]);
  return (
    <div className="three-host" ref={host}>
      {error && <div className="canvas-error">{error}</div>}
      {walk && (
        <div className="walk-hint">
          点击场景开始漫游 · WASD 移动 · E 开关门 · Esc 释放鼠标
        </div>
      )}
    </div>
  );
}
