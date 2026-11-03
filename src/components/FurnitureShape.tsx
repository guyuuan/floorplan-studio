import type { Furniture } from "@/domain/schema";

export function FurnitureShape({
  item,
  selected = false,
}: {
  item: Furniture;
  selected?: boolean;
}) {
  const { width: w, depth: d, type, color } = item;
  const stroke = selected ? "#47785d" : "#6d7469",
    sw = Math.min(w, d) * 0.022;
  const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
    r = 30,
    fill = color,
  ) => (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={r}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  );
  const line = (x: number, y: number, x2: number, y2: number) => (
    <line x1={x} y1={y} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} />
  );
  if (type === "plant" || type === "planter")
    return (
      <g>
        <ellipse rx={w * 0.42} ry={d * 0.42} fill="#c5cfbc" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <ellipse
            key={a}
            rx={w * 0.14}
            ry={d * 0.29}
            cy={-d * 0.17}
            transform={`rotate(${a})`}
            fill={a % 120 ? "#8d9d76" : "#a4b38c"}
            stroke="#7c9067"
            strokeWidth={sw}
          />
        ))}
        <circle r={w * 0.08} fill="#b2a084" />
      </g>
    );
  if (type === "rug")
    return (
      <g opacity=".8">
        {rect(-w / 2, -d / 2, w, d, 40)}
        <rect
          x={-w / 2 + 70}
          y={-d / 2 + 70}
          width={w - 140}
          height={d - 140}
          rx={25}
          fill="none"
          stroke="#eee5d5"
          strokeWidth={20}
        />
      </g>
    );
  if (["bed", "singlebed", "bunk", "tatami", "crib"].includes(type))
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d, 55)}
        {rect(-w / 2 + 30, -d / 2 + 30, w - 60, d * 0.14, 20, "#a9a48e")}
        {rect(-w * 0.43, -d * 0.31, w * 0.39, d * 0.2, 40, "#eeeade")}
        {rect(w * 0.04, -d * 0.31, w * 0.39, d * 0.2, 40, "#eeeade")}
        {rect(-w / 2 + 25, -d * 0.05, w - 50, d * 0.53, 30, "#d9d1be")}
        {line(-w / 2 + 30, d * 0.09, w / 2 - 30, d * 0.09)}
      </g>
    );
  if (["sofa", "loveseat", "armchair", "lounge"].includes(type))
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d, 70)}
        {rect(-w / 2, -d / 2, w, d * 0.25, 60)}
        {rect(-w / 2, -d * 0.23, w * 0.12, d * 0.73, 30)}
        {rect(w * 0.38, -d * 0.23, w * 0.12, d * 0.73, 30)}
        {[0, 1, 2]
          .slice(0, type === "sofa" ? 3 : type === "loveseat" ? 2 : 1)
          .map((_, i, a) => (
            <g key={i}>
              {rect(
                -w * 0.36 + (i * w * 0.72) / a.length,
                -d * 0.17,
                (w * 0.72) / a.length,
                d * 0.59,
                45,
                "#d8d5c5",
              )}
            </g>
          ))}
      </g>
    );
  if (
    ["roundtable", "roundcoffee", "smalltable", "balconytable"].includes(type)
  )
    return (
      <ellipse
        rx={w / 2}
        ry={d / 2}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
      />
    );
  if (type === "toilet")
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d * 0.24, 30, "#ecece3")}
        <ellipse
          cy={d * 0.1}
          rx={w * 0.43}
          ry={d * 0.36}
          fill="#f2f1e9"
          stroke={stroke}
          strokeWidth={sw}
        />
        <ellipse
          cy={d * 0.08}
          rx={w * 0.28}
          ry={d * 0.25}
          fill="#d9ddd4"
          stroke={stroke}
          strokeWidth={sw}
        />
      </g>
    );
  if (["sink", "vanity"].includes(type))
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d, 20)}
        {rect(-w * 0.34, -d * 0.34, w * 0.68, d * 0.6, 50, "#e4e8df")}
        <circle r={25} fill={stroke} />
        {line(0, -d * 0.4, 0, -d * 0.2)}
      </g>
    );
  if (type === "shower")
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d, 20, "#d7e3de")}
        <path
          d={`M ${-w / 2} ${-d / 2} L ${w / 2} ${d / 2} M ${w / 2} ${-d / 2} L ${-w / 2} ${d / 2}`}
          stroke="#a7b8b0"
          strokeWidth={sw}
        />
        <circle r={35} fill="#9daea4" />
      </g>
    );
  if (type === "bathtub" || type === "tubround")
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d, d * 0.45, "#eeeede")}
        {rect(-w * 0.43, -d * 0.36, w * 0.86, d * 0.72, d * 0.3, "#dfe5dc")}
      </g>
    );
  if (["chair", "officechair", "foldchair", "barstool"].includes(type))
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d, 70)}
        {rect(-w / 2, -d / 2, w, d * 0.22, 40, "#a89e87")}
      </g>
    );
  if (type === "stove")
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d, 20)}
        {[-0.25, 0.25].map((x) => (
          <circle
            key={x}
            cx={w * x}
            r={d * 0.22}
            fill="#96998d"
            stroke={stroke}
            strokeWidth={sw}
          />
        ))}
      </g>
    );
  if (
    [
      "wardrobe",
      "cabinet",
      "bookshelf",
      "tallcabinet",
      "shoe",
      "shelf",
    ].includes(type)
  )
    return (
      <g>
        {rect(-w / 2, -d / 2, w, d, 12)}
        {line(0, -d / 2, 0, d / 2)}
        {line(-w / 2, d * 0.25, w / 2, d * 0.25)}
        <circle cx={-30} cy={d * 0.1} r={12} fill={stroke} />
        <circle cx={30} cy={d * 0.1} r={12} fill={stroke} />
      </g>
    );
  return (
    <g>
      {rect(-w / 2, -d / 2, w, d, 30)}
      <rect
        x={-w / 2 + 40}
        y={-d / 2 + 40}
        width={Math.max(w - 80, 10)}
        height={Math.max(d - 80, 10)}
        rx={20}
        fill="none"
        stroke="#ffffff55"
        strokeWidth={sw}
      />
    </g>
  );
}
