"use client";
import { useMemo, useRef, useState } from "react";
import type { Furniture, Plan, Point, Wall } from "@/domain/schema";
import {
  along,
  bounds,
  centroid,
  distanceToWall,
  length,
  roomArea,
  wallLength,
  wallFootprints,
  wallOutline,
  connectWallEndpoints,
  overlappingWall,
} from "@/domain/geometry";
import { materials } from "@/domain/schema";
import { FurnitureShape } from "./FurnitureShape";
import { doorStyle, doorLeafCount, getOpeningType } from "@/domain/openings";

export type Selection = {
  kind: "wall" | "opening" | "furniture" | "room";
  id: string;
} | null;
export type Tool = "select" | "wall" | "door" | "window" | "measure" | "pan";
export type Layers = {
  grid: boolean;
  dimensions: boolean;
  rooms: boolean;
  furniture: boolean;
  bearing: boolean;
  source: boolean;
};
type Props = {
  plan: Plan;
  selection: Selection;
  onSelect: (s: Selection) => void;
  tool: Tool;
  layers: Layers;
  zoom: number;
  onZoom: (n: number) => void;
  sourceUrl?: string;
  onMove: (f: Furniture) => void;
  onWall: (a: Point, b: Point) => void;
  onOpening: (wall: Wall, offset: number, kind: "door" | "window") => void;
  onDropItem: (type: string, p: Point) => void;
};
export function PlanCanvas({
  plan,
  selection,
  onSelect,
  tool,
  layers,
  zoom,
  onZoom,
  sourceUrl,
  onMove,
  onWall,
  onOpening,
  onDropItem,
}: Props) {
  const ref = useRef<SVGSVGElement>(null),
    drag = useRef<{ f: Furniture; start: Point; original: Point } | null>(null),
    panStart = useRef<{ p: Point; offset: Point } | null>(null);
  const [pan, setPan] = useState<Point>([0, 0]),
    [ghost, setGhost] = useState<Furniture | null>(null),
    [start, setStart] = useState<Point | null>(null),
    [cursor, setCursor] = useState<Point | null>(null),
    [measure, setMeasure] = useState<[Point, Point] | null>(null);
  const footprints = useMemo(() => wallFootprints(plan.walls), [plan.walls]);
  const b = bounds(plan),
    padding = 1000,
    viewW = (b.width + padding * 2) / zoom,
    viewH = (b.height + padding * 2) / zoom;
  const view = [
    b.x + b.width / 2 - viewW / 2 + pan[0],
    b.y + b.height / 2 - viewH / 2 + pan[1],
    viewW,
    viewH,
  ];
  const point = (event: { clientX: number; clientY: number }): Point => {
    const svg = ref.current!,
      p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return [q.x, q.y];
  };
  const snap = (p: Point, origin?: Point, shift = false): Point => {
    let q: Point = [Math.round(p[0] / 10) * 10, Math.round(p[1] / 10) * 10];
    const ends = plan.walls.flatMap((w) => [w.a, w.b]);
    const end = ends.find((e) => length(e, q) < 100 / zoom);
    if (end) q = [...end];
    if (origin && shift)
      q =
        Math.abs(q[0] - origin[0]) > Math.abs(q[1] - origin[1])
          ? [q[0], origin[1]]
          : [origin[0], q[1]];
    return q;
  };
  const previewWall =
    start && cursor && tool === "wall" && length(start, cursor) >= 100
      ? connectWallEndpoints(
          {
            id: "wall_preview",
            a: start,
            b: cursor,
            thickness: 120,
            height: 2800,
            kind: "partition",
            reviewed: true,
          },
          plan.walls,
          80 / zoom,
        )
      : null;
  const previewConflict = previewWall
    ? overlappingWall(previewWall, plan.walls)
    : null;
  const pointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (tool === "pan" || e.button === 1) {
      panStart.current = { p: [e.clientX, e.clientY], offset: pan };
      ref.current?.setPointerCapture(e.pointerId);
      return;
    }
    const p = snap(point(e));
    if (tool === "wall" || tool === "measure") {
      setStart(p);
      setCursor(p);
      ref.current?.setPointerCapture(e.pointerId);
    } else if (
      e.target === e.currentTarget ||
      (e.target as Element).getAttribute("data-background") === "true"
    )
      onSelect(null);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panStart.current) {
      const rect = ref.current!.getBoundingClientRect(),
        ratio = Math.max(viewW / rect.width, viewH / rect.height);
      setPan([
        panStart.current.offset[0] -
          (e.clientX - panStart.current.p[0]) * ratio,
        panStart.current.offset[1] -
          (e.clientY - panStart.current.p[1]) * ratio,
      ]);
      return;
    }
    if (drag.current) {
      const d = drag.current,
        p = point(e),
        f = {
          ...d.f,
          position: [
            Math.round((d.original[0] + p[0] - d.start[0]) / 10) * 10,
            Math.round((d.original[1] + p[1] - d.start[1]) / 10) * 10,
          ] as Point,
        };
      if (!e.altKey) {
        const rad = (f.rotation * Math.PI) / 180;
        const ex =
            (Math.abs(f.width * Math.cos(rad)) +
              Math.abs(f.depth * Math.sin(rad))) /
            2,
          ey =
            (Math.abs(f.width * Math.sin(rad)) +
              Math.abs(f.depth * Math.cos(rad))) /
            2;
        for (const w of plan.walls) {
          const hit = distanceToWall(f.position, w);
          if (hit.offset < 1 || hit.offset > wallLength(w) - 1) continue;
          if (Math.abs(w.a[0] - w.b[0]) < 1) {
            const distance = ex + w.thickness / 2;
            if (Math.abs(Math.abs(f.position[0] - w.a[0]) - distance) < 90)
              f.position[0] =
                w.a[0] + Math.sign(f.position[0] - w.a[0]) * distance;
          }
          if (Math.abs(w.a[1] - w.b[1]) < 1) {
            const distance = ey + w.thickness / 2;
            if (Math.abs(Math.abs(f.position[1] - w.a[1]) - distance) < 90)
              f.position[1] =
                w.a[1] + Math.sign(f.position[1] - w.a[1]) * distance;
          }
        }
      }
      setGhost(f);
      return;
    }
    if (start) setCursor(snap(point(e), start, e.shiftKey));
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current) {
      if (ghost && length(ghost.position, drag.current.original) > 1)
        onMove(ghost);
      drag.current = null;
      setGhost(null);
    }
    if (start && cursor && length(start, cursor) > 100) {
      if (tool === "wall" && previewWall) onWall(previewWall.a, previewWall.b);
      if (tool === "measure") setMeasure([start, cursor]);
    }
    setStart(null);
    setCursor(null);
    panStart.current = null;
    if (ref.current?.hasPointerCapture(e.pointerId))
      ref.current.releasePointerCapture(e.pointerId);
  };
  const wallClick = (e: React.MouseEvent, w: Wall) => {
    e.stopPropagation();
    if (tool === "door" || tool === "window")
      onOpening(
        w,
        Math.round(distanceToWall(point(e), w).offset / 10) * 10,
        tool,
      );
    else if (tool === "select") onSelect({ kind: "wall", id: w.id });
  };
  const renderMeasure = (a: Point, b: Point, key: string) => (
    <g key={key} pointerEvents="none">
      <path
        d={`M${a}L${b}`}
        stroke="#47785d"
        strokeWidth={22 / zoom}
        strokeDasharray={`${60 / zoom} ${35 / zoom}`}
      />
      {[a, b].map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={40 / zoom} fill="#47785d" />
      ))}
      <g
        transform={`translate(${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2 - 100 / zoom})`}
      >
        <rect
          x={-420 / zoom}
          y={-160 / zoom}
          width={840 / zoom}
          height={230 / zoom}
          rx={50 / zoom}
          fill="#47785d"
        />
        <text textAnchor="middle" fill="white" fontSize={135 / zoom}>
          {Math.round(length(a, b))} mm
        </text>
      </g>
    </g>
  );
  return (
    <svg
      ref={ref}
      className={`plan-canvas tool-${tool}`}
      data-plan-export="true"
      role="img"
      aria-label="可编辑的 2D 户型图"
      viewBox={view.join(" ")}
      onPointerDown={pointerDown}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        drag.current = null;
        panStart.current = null;
        setGhost(null);
        setStart(null);
        setCursor(null);
      }}
      onWheel={(e) => {
        onZoom(
          Math.max(0.45, Math.min(3, zoom * (e.deltaY > 0 ? 0.92 : 1.08))),
        );
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const t = e.dataTransfer.getData("floorplan-furniture");
        if (t) onDropItem(t, snap(point(e)));
      }}
    >
      <defs>
        <pattern
          id="plan-grid"
          width={500}
          height={500}
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 500 0 L 0 0 0 500"
            fill="none"
            stroke="#dce0d5"
            strokeWidth={9}
          />
        </pattern>
        <pattern
          id="wood-grain"
          width={220}
          height={1700}
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 0 0 V1700 M 220 850 H0"
            stroke="#a98e6620"
            strokeWidth={8}
          />
        </pattern>
      </defs>
      <rect
        data-background="true"
        x={view[0] - 1000}
        y={view[1] - 1000}
        width={viewW + 2000}
        height={viewH + 2000}
        fill="#f4f5ef"
      />
      {layers.grid && (
        <rect
          data-background="true"
          x={view[0]}
          y={view[1]}
          width={viewW}
          height={viewH}
          fill="url(#plan-grid)"
        />
      )}
      {sourceUrl && layers.source && (
        <image
          href={sourceUrl}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          opacity={plan.walls.length ? 0.25 : 1}
          preserveAspectRatio="xMidYMid meet"
          pointerEvents="none"
        />
      )}
      {plan.rooms.map((r) => (
        <g
          key={r.id}
          onClick={(e) => {
            if (tool === "select") {
              e.stopPropagation();
              onSelect({ kind: "room", id: r.id });
            }
          }}
        >
          <path
            d={[r.polygon, ...r.holes]
              .map((poly) => `M${poly.map((p) => p.join(",")).join("L")}Z`)
              .join("")}
            fill={materials[r.material].color}
            fillRule="evenodd"
            stroke={
              selection?.kind === "room" && selection.id === r.id
                ? "#5b8060"
                : "none"
            }
            strokeWidth={35}
          />
          {(r.material === "oak" || r.material === "walnut") && (
            <polygon
              points={r.polygon.map((p) => p.join(",")).join(" ")}
              fill="url(#wood-grain)"
              pointerEvents="none"
            />
          )}
        </g>
      ))}
      {layers.furniture &&
        [...plan.furniture]
          .sort(
            (a, b) => (a.type === "rug" ? -1 : 0) - (b.type === "rug" ? -1 : 0),
          )
          .map((f) => {
            const item = ghost?.id === f.id ? ghost : f;
            const selected =
              selection?.kind === "furniture" && selection.id === f.id;
            return (
              <g
                key={f.id}
                transform={`translate(${item.position}) rotate(${item.rotation})`}
                className="furniture-object"
                onClick={(e) => {
                  if (tool === "select") {
                    e.stopPropagation();
                    onSelect({ kind: "furniture", id: f.id });
                  }
                }}
                onPointerDown={(e) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  onSelect({ kind: "furniture", id: f.id });
                  drag.current = { f, start: point(e), original: f.position };
                  ref.current?.setPointerCapture(e.pointerId);
                }}
              >
                <FurnitureShape item={item} selected={selected} />
                {selected && (
                  <rect
                    x={-f.width / 2 - 45}
                    y={-f.depth / 2 - 45}
                    width={f.width + 90}
                    height={f.depth + 90}
                    fill="none"
                    stroke="#47785d"
                    strokeWidth={25}
                    strokeDasharray="65 45"
                  />
                )}
              </g>
            );
          })}
      {plan.walls.map((w) => {
        const selected = selection?.kind === "wall" && selection.id === w.id;
        const fill = selected
          ? "#5f8266"
          : w.kind === "exterior"
            ? "#505b50"
            : w.kind === "bearing"
              ? layers.bearing
                ? "#b27d62"
                : "#505b50"
              : w.kind === "unknown"
                ? "#d2ae63"
                : "#92998a";
        return (
          <g
            key={w.id}
            className="wall-object"
            onClick={(e) => wallClick(e, w)}
          >
            {footprints[w.id].map((polygon, i) => (
              <path
                key={i}
                d={polygon
                  .map((ring) => `M${ring.map((p) => p.join(",")).join("L")}Z`)
                  .join(" ")}
                fill={fill}
                fillRule="evenodd"
              />
            ))}
            {selected && (
              <path
                d={`M${w.a}L${w.b}`}
                fill="none"
                stroke="#dcebcf"
                strokeWidth={25}
                strokeDasharray="80 50"
              />
            )}
          </g>
        );
      })}
      {plan.openings.map((o) => {
        const w = plan.walls.find((w) => w.id === o.wallId);
        if (!w) return null;
        const p = along(w, o.offset),
          angle =
            (Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180) / Math.PI,
          selected = selection?.kind === "opening" && selection.id === o.id,
          t = w.thickness,
          style = doorStyle(o),
          count = doorLeafCount(o);
        return (
          <g
            key={o.id}
            transform={`translate(${p}) rotate(${angle})`}
            onClick={(e) => {
              if (tool === "select") {
                e.stopPropagation();
                onSelect({ kind: "opening", id: o.id });
              }
            }}
            className="opening-object"
            role="button"
            tabIndex={0}
            aria-label={`${getOpeningType(o) === "passage" ? "过道" : o.kind === "door" ? "门洞" : "窗洞"} ${o.id}`}
            onKeyDown={(e) => {
              if (tool === "select" && ["Enter", " "].includes(e.key)) {
                e.preventDefault();
                onSelect({ kind: "opening", id: o.id });
              }
            }}
          >
            <rect
              y={-t / 2 - 4}
              width={o.width}
              height={t + 8}
              fill={o.kind === "window" ? "#d4e1da" : "#f0ecdf"}
              stroke={selected ? "#47785d" : "#829388"}
              strokeWidth={selected ? 35 : 15}
            />
            {o.kind === "window" ? (
              <path
                d={`M0,${-t * 0.16}H${o.width} M0,${t * 0.16}H${o.width} M${o.width / 2},${-t / 2}V${t / 2}`}
                stroke="#7e9f95"
                strokeWidth={12}
              />
            ) : style === "sliding" ? (
              <g
                stroke={selected ? "#47785d" : "#829081"}
                strokeWidth={18}
                fill="none"
              >
                {Array.from({ length: count }, (_, i) => (
                  <rect
                    key={i}
                    x={(i * o.width) / count}
                    y={i % 2 ? -t * 0.15 : t * 0.05}
                    width={o.width / count}
                    height={t * 0.2}
                  />
                ))}
              </g>
            ) : style !== "opening" ? (
              Array.from({ length: count }, (_, i) => {
                const width = o.width / count,
                  right = count === 2 ? i === 1 : o.swing === "right";
                return (
                  <g
                    key={i}
                    transform={
                      right ? `translate(${o.width},0) scale(-1,1)` : undefined
                    }
                  >
                    <path
                      d={`M0,0V${width} A${width},${width} 0 0 0 ${width},0`}
                      fill="none"
                      stroke={selected ? "#47785d" : "#829081"}
                      strokeWidth={18}
                    />
                  </g>
                );
              })
            ) : null}
          </g>
        );
      })}
      {layers.rooms &&
        plan.rooms.map((r) => {
          const c = centroid(r.polygon);
          return (
            <g key={r.id} pointerEvents="none">
              <text
                x={c[0]}
                y={c[1] - 60}
                textAnchor="middle"
                fill="#4d584c"
                fontSize={180}
                fontWeight={600}
                paintOrder="stroke"
                stroke="#f0ebde"
                strokeWidth={38}
              >
                {r.name}
              </text>
              <text
                x={c[0]}
                y={c[1] + 160}
                textAnchor="middle"
                fill="#697363"
                fontSize={140}
                paintOrder="stroke"
                stroke="#f0ebde"
                strokeWidth={30}
              >
                {roomArea(r).toFixed(1)} m²
              </text>
            </g>
          );
        })}
      {layers.dimensions && plan.boundary.length > 0 && (
        <g
          fill="#74816d"
          fontSize={145}
          textAnchor="middle"
          stroke="#85917d"
          strokeWidth={10}
          pointerEvents="none"
        >
          <path
            d={`M${b.x},${b.y - 450}H${b.x + b.width} M${b.x},${b.y - 550}V${b.y - 350} M${b.x + b.width},${b.y - 550}V${b.y - 350}`}
            fill="none"
          />
          <text x={b.x + b.width / 2} y={b.y - 540} stroke="none">
            {Math.round(b.width).toLocaleString()} mm
          </text>
          <g
            transform={`translate(${b.x - 500},${b.y + b.height / 2}) rotate(-90)`}
          >
            <path
              d={`M${-b.height / 2},0H${b.height / 2} M${-b.height / 2},-100V100 M${b.height / 2},-100V100`}
              fill="none"
            />
            <text y={-90} stroke="none">
              {Math.round(b.height).toLocaleString()} mm
            </text>
          </g>
        </g>
      )}
      {measure && renderMeasure(...measure, "saved")}
      {previewWall ? (
        <g pointerEvents="none">
          <polygon
            points={wallOutline(previewWall, plan.walls)
              .map((p) => p.join(","))
              .join(" ")}
            fill={previewConflict ? "#c07b65" : "#6c9272"}
            fillOpacity={0.45}
            stroke={previewConflict ? "#ad5948" : "#47785d"}
            strokeWidth={15}
          />
          {renderMeasure(previewWall.a, previewWall.b, "live")}
        </g>
      ) : (
        start && cursor && renderMeasure(start, cursor, "live")
      )}
      {!plan.walls.length && !sourceUrl && (
        <text
          x={5000}
          y={4000}
          textAnchor="middle"
          fill="#8c9687"
          fontSize={220}
        >
          上传户型图以开始还原
        </text>
      )}
    </svg>
  );
}
