"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  doorStyleNames,
  fitOpening,
  getOpeningType,
  withOpeningType,
  type OpeningType,
} from "@/domain/openings";
import dynamic from "next/dynamic";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Armchair,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  DoorOpen,
  Expand,
  Eye,
  FileImage,
  FolderOpen,
  Grid2X2,
  Grip,
  HelpCircle,
  History,
  ImagePlus,
  Layers,
  Leaf,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minus,
  MousePointer2,
  Move,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Redo2,
  RotateCw,
  Ruler,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Trash2,
  Undo2,
  Upload,
  Wallpaper,
  X,
} from "lucide-react";
import { catalog, type CatalogItem } from "@/domain/catalog";
import {
  area,
  bounds,
  centroid,
  roomArea,
  wallLength,
} from "@/domain/geometry";
import {
  materials,
  type Command,
  type Furniture,
  type Opening,
  type Point,
  type Project,
  type Wall,
} from "@/domain/schema";
import { demoPlan } from "@/domain/demo";
import {
  PlanCanvas,
  type Layers as LayerOptions,
  type Selection,
  type Tool,
} from "./PlanCanvas";
import { FurnitureShape } from "./FurnitureShape";
const SceneCanvas = dynamic(
  () => import("./SceneCanvas").then((m) => m.SceneCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="scene-loading">
        <LoaderCircle className="spin" />
        正在构建 3D 场景…
      </div>
    ),
  },
);
type Summary = Pick<
  Project,
  "id" | "name" | "updatedAt" | "stage" | "revision"
>;
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const wallKinds = {
  exterior: "外墙",
  bearing: "承重墙",
  partition: "非承重墙",
  unknown: "待确认",
};
const tools: {
  id: Tool;
  label: string;
  key: string;
  icon: typeof MousePointer2;
}[] = [
  { id: "select", label: "选择", key: "V", icon: MousePointer2 },
  { id: "pan", label: "平移", key: "H", icon: Move },
  { id: "wall", label: "新建墙体", key: "W", icon: Square },
  { id: "door", label: "添加门洞", key: "D", icon: DoorOpen },
  { id: "window", label: "添加窗洞", key: "O", icon: Wallpaper },
  { id: "measure", label: "测量", key: "M", icon: Ruler },
];
function Field({
  name,
  label,
  value,
  step = "any",
  min,
  max,
  disabled = false,
}: {
  name: string;
  label: string;
  value: string | number;
  step?: number | "any";
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={typeof value === "number" ? "number" : "text"}
        defaultValue={value}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        required
      />
    </label>
  );
}
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
async function jsonFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, init),
    v = await r.json();
  if (!r.ok) throw new Error(v.error ?? "操作失败");
  return v;
}

export default function Studio() {
  const [project, setProject] = useState<Project | null>(null),
    [projects, setProjects] = useState<Summary[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState("");
  const [selection, setSelection] = useState<Selection>(null),
    [tool, setTool] = useState<Tool>("select"),
    [mode, setMode] = useState<"2d" | "3d" | "split">("2d"),
    [zoom, setZoom] = useState(1),
    [canvasKey, setCanvasKey] = useState(0);
  const [layers, setLayers] = useState<LayerOptions>({
    grid: false,
    dimensions: true,
    rooms: true,
    furniture: true,
    bearing: false,
    source: false,
  });
  const [libraryTab, setLibraryTab] = useState<
      "furniture" | "walls" | "layers"
    >("furniture"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部");
  const [modal, setModal] = useState<"new" | "mcp" | "help" | "source" | null>(
      null,
    ),
    [projectMenu, setProjectMenu] = useState(false),
    [exportMenu, setExportMenu] = useState(false),
    [mcpConfig, setMcpConfig] = useState(""),
    [online, setOnline] = useState(false);
  const [cut, setCut] = useState(true),
    [time, setTime] = useState(14),
    [walk, setWalk] = useState(false),
    [view, setView] = useState<"orbit" | "top" | "angle">("orbit"),
    [focusRoom, setFocusRoom] = useState<string | null>(null),
    [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true);
  const [file, setFile] = useState<File | null>(null),
    [projectName, setProjectName] = useState("我的理想家");
  const fileInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null),
    current = useRef<Project | null>(null),
    mutating = useRef(false);
  current.current = project;
  useEffect(() => {
    if (window.innerWidth < 900) setRightOpen(false);
    if (window.innerWidth < 650) setLeftOpen(false);
  }, []);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const refreshList = useCallback(async () => {
    const list = await jsonFetch("/api/projects");
    setProjects(list);
    return list as Summary[];
  }, []);
  const openProject = useCallback(
    async (id: string) => {
      try {
        const p = await jsonFetch(`/api/projects/${id}`);
        setProject(p);
        localStorage.setItem("floorplan-project", p.id);
        setSelection(null);
        setProjectMenu(false);
        setZoom(1);
        setCanvasKey((k) => k + 1);
        setWalk(false);
        setMode("2d");
        setLayers((l) => ({ ...l, source: !p.plan.walls.length }));
      } catch (e) {
        notify(String(e instanceof Error ? e.message : e));
      }
    },
    [notify],
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await refreshList();
        await jsonFetch("/api/status");
        if (cancelled) return;
        setOnline(true);
        const last = localStorage.getItem("floorplan-project");
        if (last && list.some((p) => p.id === last)) await openProject(last);
      } catch (e) {
        if (!cancelled) notify(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList, openProject, notify]);
  useEffect(() => {
    if (!project) return;
    const id = project.id;
    let inFlight = false,
      cancelled = false;
    const timer = setInterval(async () => {
      if (document.hidden || inFlight || mutating.current) return;
      inFlight = true;
      try {
        const p = await jsonFetch(`/api/projects/${id}`);
        if (
          !cancelled &&
          !mutating.current &&
          current.current?.id === id &&
          p.revision > current.current.revision
        ) {
          setProject(p);
          if (p.activity[0]?.actor === "agent")
            notify(`Agent 已更新方案 · ${p.activity[0].text}`);
        }
      } catch {
      } finally {
        inFlight = false;
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [project?.id, notify]);
  const run = useCallback(
    async (commands: Command[]) => {
      const p = current.current;
      if (!p || mutating.current) return false;
      mutating.current = true;
      setBusy(true);
      try {
        const next = await jsonFetch(`/api/projects/${p.id}/commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: p.revision, commands }),
        });
        setProject(next);
        void refreshList().catch(() => {});
        return true;
      } catch (e) {
        notify(e instanceof Error ? e.message : "操作失败");
        try {
          const latest = await jsonFetch(`/api/projects/${p.id}`);
          if (current.current?.id === p.id) setProject(latest);
        } catch {}
        return false;
      } finally {
        mutating.current = false;
        setBusy(false);
      }
    },
    [notify, refreshList],
  );
  const create = async (demo = false) => {
    if (!demo && !file) {
      notify("请选择户型图片。");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("name", demo ? "林间公寓 · 示例方案" : projectName);
      form.set("demo", String(demo));
      if (file) form.set("image", file);
      const p = await jsonFetch("/api/projects", {
        method: "POST",
        body: form,
      });
      setProject(p);
      localStorage.setItem("floorplan-project", p.id);
      setModal(null);
      setFile(null);
      setSelection(null);
      setZoom(1);
      setCanvasKey((k) => k + 1);
      setMode("2d");
      setLayers((l) => ({ ...l, source: !demo }));
      void refreshList().catch(() => {});
      notify(
        demo
          ? "已创建独立示例项目，可以自由编辑。"
          : "图片已上传，连接外部 Agent 开始还原。",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };
  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      notify("请选择 PNG、JPG 或 WebP 图片。");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      notify("图片不能超过 10 MB。");
      return;
    }
    setFile(f);
    if (projectName === "我的理想家")
      setProjectName(f.name.replace(/\.[^.]+$/, ""));
  };
  const moveFurniture = useCallback(
    (f: Furniture) => {
      void run([{ type: "upsert_furniture", furniture: f }]);
    },
    [run],
  );
  const addFurniture = useCallback(
    (type: string, position?: Point) => {
      const p = current.current;
      if (!p || p.stage !== "design") {
        notify("请先还原并确认户型，再布置家具。");
        return;
      }
      const item = catalog.find((i) => i.type === type);
      if (!item) return;
      const room = [...p.plan.rooms].sort(
          (a, b) => roomArea(b) - roomArea(a),
        )[0],
        b = bounds(p.plan),
        pos =
          position ??
          (room
            ? centroid(room.polygon)
            : ([b.x + b.width / 2, b.y + b.height / 2] as Point));
      const { category: _, ...f } = item;
      const id = uid("f");
      void run([
        {
          type: "upsert_furniture",
          furniture: { ...f, id, position: pos, rotation: 0 },
        },
      ]).then((ok) => {
        if (ok) setSelection({ kind: "furniture", id });
      });
    },
    [run, notify],
  );
  const addWall = useCallback(
    (a: Point, b: Point) => {
      const id = uid("wall");
      void run([
        {
          type: "add_wall",
          wall: {
            id,
            a,
            b,
            thickness: 120,
            height: 2800,
            kind: "partition",
            reviewed: true,
          },
        },
      ]).then((ok) => {
        if (ok) {
          setSelection({ kind: "wall", id });
          setTool("select");
        }
      });
    },
    [run],
  );
  const addOpening = useCallback(
    (wall: Wall, offset: number, kind: "door" | "window") => {
      const placement = fitOpening(
        wall,
        current.current?.plan.openings ?? [],
        offset,
        kind,
      );
      if (!placement) {
        notify("此处没有足够的空白墙段，请调整位置或先编辑现有门窗。");
        return;
      }
      const id = uid(kind);
      void run([
        {
          type: "upsert_opening",
          opening: {
            id,
            wallId: wall.id,
            kind,
            ...placement,
          },
        },
      ]).then((ok) => {
        if (ok) {
          setSelection({ kind: "opening", id });
          setTool("select");
        }
      });
    },
    [run],
  );
  const deleteSelection = useCallback(() => {
    const p = current.current;
    if (!p || !selection) return;
    let c: Command | undefined;
    if (selection.kind === "furniture")
      c = { type: "delete_furniture", furnitureId: selection.id };
    if (selection.kind === "opening")
      c = { type: "delete_opening", openingId: selection.id };
    if (selection.kind === "wall")
      c = { type: "remove_wall", wallId: selection.id };
    if (c)
      void run([c]).then((ok) => {
        if (ok) setSelection(null);
      });
  }, [selection, run]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).matches("input,textarea,select") ||
        modal ||
        walk
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void run([{ type: e.shiftKey ? "redo" : "undo" }]);
        return;
      }
      if (e.key === "Escape") {
        setSelection(null);
        setTool("select");
        setProjectMenu(false);
        setExportMenu(false);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key.toLowerCase() === "r" && selection?.kind === "furniture") {
        const f = current.current?.plan.furniture.find(
          (f) => f.id === selection.id,
        );
        if (f)
          moveFurniture({
            ...f,
            rotation: f.rotation + (e.shiftKey ? -90 : 90),
          });
        return;
      }
      if (e.key.toLowerCase() === "f") {
        setZoom(1);
        setCanvasKey((k) => k + 1);
      }
      const t = tools.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (t && !mod) setTool(t.id);
      if (e.key.toLowerCase() === "t")
        setMode((m) => (m === "2d" ? "3d" : "2d"));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [modal, walk, selection, deleteSelection, run, moveFurniture]);
  const connect = async () => {
    setModal("mcp");
    try {
      setMcpConfig(JSON.stringify(await jsonFetch("/api/setup"), null, 2));
    } catch (e) {
      notify(String(e));
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制到剪贴板。");
    } catch {
      notify("剪贴板不可用，请手动复制。");
    }
  };
  const exportPng = async () => {
    setExportMenu(false);
    const p = current.current;
    if (!p) return;
    const savePng = async (canvas: HTMLCanvasElement, name: string) => {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("PNG encoding failed")),
          "image/png",
        ),
      );
      const saved = await jsonFetch(`/api/projects/${p.id}/png`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: blob,
      });
      download(`${saved.url}?v=${Date.now()}`, name);
      notify("PNG 已生成。");
    };
    try {
      const canvas = document.querySelector<HTMLCanvasElement>(
        "[data-three-export]",
      );
      if (mode === "3d" && canvas) {
        await savePng(canvas, `${p.name}-3D.png`);
        return;
      }
      const svg = document.querySelector<SVGSVGElement>("[data-plan-export]");
      if (!svg) return;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll("image").forEach((e) => e.remove());
      clone.setAttribute("width", "2400");
      clone.setAttribute("height", "1800");
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml",
        }),
      );
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });
      const output = document.createElement("canvas");
      output.width = 2400;
      output.height = 1800;
      const ctx = output.getContext("2d")!;
      ctx.fillStyle = "#f4f5ef";
      ctx.fillRect(0, 0, 2400, 1800);
      ctx.drawImage(img, 0, 0, 2400, 1800);
      URL.revokeObjectURL(url);
      await savePng(output, `${p.name}-2D.png`);
    } catch (error) {
      console.error("PNG export failed", error);
      notify("图片导出失败，请重试。");
    }
  };
  const importJson = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 18 * 1024 * 1024) {
      notify("JSON 文件过大。");
      return;
    }
    setBusy(true);
    try {
      const p = await jsonFetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await f.text(),
      });
      setProject(p);
      localStorage.setItem("floorplan-project", p.id);
      setSelection(null);
      setMode("2d");
      setZoom(1);
      setCanvasKey((k) => k + 1);
      void refreshList().catch(() => {});
      notify("方案已作为新项目导入，请重新核对墙体类型。");
    } catch (e) {
      notify(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  };
  const plan = project?.plan,
    selectedWall =
      selection?.kind === "wall"
        ? plan?.walls.find((w) => w.id === selection.id)
        : undefined,
    selectedFurniture =
      selection?.kind === "furniture"
        ? plan?.furniture.find((f) => f.id === selection.id)
        : undefined,
    selectedOpening =
      selection?.kind === "opening"
        ? plan?.openings.find((o) => o.id === selection.id)
        : undefined,
    selectedRoom =
      selection?.kind === "room"
        ? plan?.rooms.find((r) => r.id === selection.id)
        : undefined;
  const totalArea = plan?.rooms.reduce((s, r) => s + roomArea(r), 0) ?? 0,
    cost =
      plan?.rooms.reduce(
        (s, r) => s + roomArea(r) * materials[r.material].price * 1.05,
        0,
      ) ?? 0;
  const filtered = catalog.filter(
    (i) =>
      (category === "全部" || i.category === category) &&
      `${i.name}${i.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  const sourceUrl = project?.source
    ? `/api/projects/${project.id}/source`
    : undefined;
  const canvasProps = plan
    ? {
        plan,
        selection,
        onSelect: setSelection,
        tool,
        layers,
        zoom,
        onZoom: setZoom,
        sourceUrl,
        onMove: moveFurniture,
        onWall: addWall,
        onOpening: addOpening,
        onDropItem: addFurniture,
        keyboardEnabled: !modal && !walk,
      }
    : null;
  const actualTool =
    tool === "wall"
      ? "按住拖动绘制墙体 · Shift 锁定水平/垂直"
      : tool === "measure"
        ? "按住拖动测量 · Shift 锁定方向"
        : tool === "door" || tool === "window"
          ? "点击已确认的非承重内墙添加洞口"
          : "拖动家具调整位置 · Alt 暂停贴墙吸附";
  return (
    <main className="studio-shell">
      <header className="topbar">
        <a href="/" className="brand" aria-label="筑间首页">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <strong>
            筑间<span>FLOORPLAN STUDIO</span>
          </strong>
        </a>
        <span className="top-divider" />
        <div className="project-picker">
          <button
            className="project-title"
            onClick={() => setProjectMenu(!projectMenu)}
          >
            <FolderOpen size={16} />
            <span>{project?.name ?? "我的设计空间"}</span>
            <ChevronDown size={14} />
          </button>
          {projectMenu && (
            <div className="dropdown project-dropdown">
              <span className="menu-label">我的项目</span>
              {projects.map((p) => (
                <button key={p.id} onClick={() => void openProject(p.id)}>
                  <span>{p.name}</span>
                  {project?.id === p.id && <Check size={14} />}
                </button>
              ))}
              {!projects.length && <p className="muted small">还没有项目</p>}
              <button
                onClick={() => {
                  setModal("new");
                  setProjectMenu(false);
                }}
              >
                <Plus size={15} />
                新建项目
              </button>
              <button
                onClick={() => {
                  importInput.current?.click();
                  setProjectMenu(false);
                }}
              >
                <Upload size={15} />
                导入方案 JSON
              </button>
            </div>
          )}
        </div>
        <span className="save-status">
          {busy ? (
            <>
              <LoaderCircle size={12} className="spin" />
              保存中
            </>
          ) : project ? (
            <>
              <CheckCheck size={13} />
              已保存到本机
            </>
          ) : (
            <>
              <Leaf size={13} />
              为生活留一点想象
            </>
          )}
        </span>
        <div className="top-actions">
          <IconButton
            label="撤销 ⌘Z"
            disabled={!project?.history.length || busy}
            onClick={() => void run([{ type: "undo" }])}
          >
            <Undo2 size={17} />
          </IconButton>
          <IconButton
            label="重做 ⌘⇧Z"
            disabled={!project?.future.length || busy}
            onClick={() => void run([{ type: "redo" }])}
          >
            <Redo2 size={17} />
          </IconButton>
          <span className="top-divider" />
          <button
            className="button light mcp-button"
            onClick={() => void connect()}
          >
            <Link2 size={15} />
            <span>连接 Agent</span>
            <i className={online ? "status-dot" : "status-dot offline"} />
          </button>
          <div className="export-wrap">
            <button
              className="button primary"
              disabled={!project || busy}
              onClick={() => setExportMenu(!exportMenu)}
            >
              <ArrowDownToLine size={15} />
              导出方案
              <ChevronDown size={13} />
            </button>
            {exportMenu && (
              <div className="dropdown export-dropdown">
                <button onClick={() => void exportPng()}>
                  <FileImage size={15} />
                  导出当前{mode === "3d" ? " 3D" : " 2D"} PNG
                </button>
                <button
                  onClick={() => {
                    if (project)
                      download(
                        `/api/projects/${project.id}/export`,
                        `${project.name}.json`,
                      );
                    setExportMenu(false);
                  }}
                >
                  <ArrowDownToLine size={15} />
                  导出完整方案 JSON
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="workspace-heading">
        <div className="breadcrumbs">
          工作空间
          <ChevronRight size={12} />
          <span>{project?.name ?? "开始新设计"}</span>
        </div>
        <div className="workflow-steps">
          <span
            className={project?.stage === "reconstruction" ? "current" : ""}
          >
            <b>{project?.stage === "design" ? <Check size={11} /> : 1}</b>
            还原户型
          </span>
          <i />
          <span className={project?.stage === "design" ? "current" : ""}>
            <b>2</b>空间设计
          </span>
        </div>
        <button className="text-button" onClick={() => setModal("help")}>
          <HelpCircle size={14} />
          使用指南
        </button>
      </div>
      <div
        className={`workspace ${leftOpen ? "" : "left-closed"} ${rightOpen ? "" : "right-closed"}`}
      >
        <aside className="library-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DESIGN LIBRARY</span>
              <h2>设计素材</h2>
            </div>
            <IconButton label="收起素材面板" onClick={() => setLeftOpen(false)}>
              <PanelLeftClose size={16} />
            </IconButton>
          </div>
          <div className="panel-tabs">
            <button
              className={libraryTab === "furniture" ? "active" : ""}
              onClick={() => setLibraryTab("furniture")}
            >
              <Armchair size={15} />
              家具
            </button>
            <button
              className={libraryTab === "walls" ? "active" : ""}
              onClick={() => setLibraryTab("walls")}
            >
              <Square size={14} />
              墙体
            </button>
            <button
              className={libraryTab === "layers" ? "active" : ""}
              onClick={() => setLibraryTab("layers")}
            >
              <Layers size={15} />
              图层
            </button>
          </div>
          {libraryTab === "furniture" && (
            <>
              <label className="search-input">
                <Search size={15} />
                <input
                  placeholder="寻找一件合适的家具"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span>⌕</span>
              </label>
              <div className="category-list">
                {[
                  "全部",
                  "客厅",
                  "卧室",
                  "餐厨",
                  "卫浴",
                  "书房",
                  "家电",
                  "休闲",
                ].map((c) => (
                  <button
                    key={c}
                    className={c === category ? "active" : ""}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="library-meta">
                <span>{category === "全部" ? "全部家具" : category}</span>
                <span>{filtered.length} 件</span>
              </div>
              <div className="furniture-library">
                {filtered.map((item) => (
                  <button
                    className="furniture-card"
                    key={item.type}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("floorplan-furniture", item.type)
                    }
                    onClick={() => addFurniture(item.type)}
                    title={`点击添加 ${item.name}，或拖动到平面图`}
                  >
                    <div className="furniture-thumb">
                      <svg
                        viewBox={`${-item.width * 0.7} ${-item.depth * 0.7} ${item.width * 1.4} ${item.depth * 1.4}`}
                        aria-hidden="true"
                      >
                        <FurnitureShape
                          item={{
                            ...item,
                            id: item.type,
                            position: [0, 0],
                            rotation: 0,
                          }}
                        />
                      </svg>
                      <Plus className="card-add" size={14} />
                    </div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.width} × {item.depth}
                    </span>
                  </button>
                ))}
                {!filtered.length && (
                  <p className="empty-small">没有找到匹配的家具</p>
                )}
              </div>
              <div className="library-tip">
                <Grip size={14} />
                <span>拖动家具到画布，构想家的模样</span>
              </div>
            </>
          )}
          {libraryTab === "walls" && (
            <div className="panel-scroll">
              <p className="muted small">
                点击墙体核对类型。只有用户可以纠正分类，Agent 无权解除保护。
              </p>
              <div className="wall-legend">
                <span>
                  <i className="exterior" />
                  外墙
                </span>
                <span>
                  <i className="bearing" />
                  承重墙
                </span>
                <span>
                  <i className="partition" />
                  非承重
                </span>
                <span>
                  <i className="unknown" />
                  待确认
                </span>
              </div>
              {plan?.walls.map((w) => (
                <button
                  className={`wall-list-item ${selection?.id === w.id ? "active" : ""}`}
                  key={w.id}
                  onClick={() => {
                    setSelection({ kind: "wall", id: w.id });
                    setTool("select");
                  }}
                >
                  <i className={`wall-swatch ${w.kind}`} />
                  <span>
                    {wallKinds[w.kind]}
                    <small>
                      {w.id} · {Math.round(wallLength(w))} mm
                    </small>
                  </span>
                  {w.reviewed ? (
                    <Check size={14} />
                  ) : (
                    <span className="review-dot" />
                  )}
                </button>
              ))}
              {!plan?.walls.length && (
                <p className="empty-small">还原户型后，墙体会显示在这里</p>
              )}
            </div>
          )}
          {libraryTab === "layers" && (
            <div className="panel-scroll">
              <h3>画布图层</h3>
              {(
                [
                  ["dimensions", "尺寸标注"],
                  ["rooms", "房间名称与面积"],
                  ["furniture", "家具布置"],
                  ["grid", "参考网格"],
                  ["bearing", "突出显示承重墙"],
                  ["source", "原图参考（适应画布）"],
                ] as [keyof LayerOptions, string][]
              ).map(([key, label]) => (
                <label className="toggle-row" key={key}>
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(e) =>
                      setLayers({ ...layers, [key]: e.target.checked })
                    }
                  />
                </label>
              ))}
              {project?.source && (
                <button
                  className="button light full"
                  onClick={() => setModal("source")}
                >
                  <Eye size={15} />
                  查看原始户型图
                </button>
              )}
              <div className="quiet-note">
                原图参考按画布适应显示；尺寸以校准后的模型为准。
              </div>
            </div>
          )}
        </aside>
        <section className="canvas-panel">
          <div className="canvas-topline">
            <div className="view-switch">
              {(["2d", "3d", "split"] as const).map((v) => (
                <button
                  key={v}
                  className={mode === v ? "active" : ""}
                  onClick={() => {
                    setMode(v);
                    setWalk(false);
                  }}
                >
                  {v === "2d" ? (
                    <Grid2X2 size={14} />
                  ) : v === "3d" ? (
                    <Box size={14} />
                  ) : (
                    <Layers size={14} />
                  )}
                  <span>
                    {v === "split"
                      ? "双视图"
                      : v.toUpperCase() +
                        " 平面".replace("平面", v === "3d" ? "空间" : "平面")}
                  </span>
                </button>
              ))}
            </div>
            <span className="canvas-stage">
              {project?.stage === "design" ? (
                <>
                  <span className="status-dot" />
                  设计中
                </>
              ) : project ? (
                "待还原与核对"
              ) : (
                "让想象，落在空间里"
              )}
            </span>
          </div>
          {!leftOpen && (
            <button
              className="restore-panel left"
              title="展开素材"
              onClick={() => setLeftOpen(true)}
            >
              <Layers size={17} />
            </button>
          )}
          {!rightOpen && (
            <button
              className="restore-panel right"
              title="展开属性"
              onClick={() => setRightOpen(true)}
            >
              <Settings2 size={17} />
            </button>
          )}
          {!project ? (
            <div className="welcome-canvas">
              <div className="welcome-decoration">
                <MiniPlan />
              </div>
              <div className="welcome-content">
                <span className="eyebrow">
                  A LITTLE SPACE, ENDLESS POSSIBILITIES
                </span>
                <h1>
                  从一张户型图，
                  <br />
                  开始理想的家。
                </h1>
                <p>还原空间的每一寸，用 2D 与 3D 探索家的可能。</p>
                <button
                  className="button primary large"
                  disabled={!loaded || busy}
                  onClick={() => setModal("new")}
                >
                  <ImagePlus size={18} />
                  上传户型图
                  <ArrowUpRight size={17} />
                </button>
                <button
                  className="welcome-example"
                  disabled={!loaded || busy}
                  onClick={() => void create(true)}
                >
                  或先探索一个示例空间 <ArrowUpRight size={13} />
                </button>
                <div className="welcome-format">
                  PNG / JPG / WebP<span>最大 10 MB</span>
                </div>
              </div>
              <div className="welcome-bottom">
                <ShieldCheck size={15} />
                原图与设计保存在本机<span>·</span>外墙与承重墙保护
              </div>
            </div>
          ) : (
            <>
              {!plan?.walls.length && (
                <div className="reconstruction-banner">
                  <span>
                    <ImagePlus size={16} />
                    原图已就绪，等待外部 Agent 还原户型
                  </span>
                  <button onClick={() => void connect()}>
                    连接 Agent
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              )}
              <div className={`canvas-views mode-${mode}`}>
                {(mode === "2d" || mode === "split") && canvasProps && (
                  <div className="view-pane two-d">
                    <PlanCanvas
                      key={`${project.id}-${canvasKey}`}
                      {...canvasProps}
                    />
                    <span className="view-label">2D / FLOOR PLAN</span>
                    <div className="north-marker">
                      <span>N</span>
                      <svg width="24" height="30" viewBox="0 0 24 30">
                        <path
                          d="M12 2L4 25L12 19L20 25Z"
                          fill="none"
                          stroke="currentColor"
                        />
                        <path d="M12 2V19L4 25Z" fill="currentColor" />
                      </svg>
                    </div>
                  </div>
                )}
                {(mode === "3d" || mode === "split") && plan && (
                  <div className="view-pane">
                    <SceneCanvas
                      plan={plan}
                      selection={selection}
                      onSelect={setSelection}
                      onMove={moveFurniture}
                      cut={cut}
                      time={time}
                      walk={walk}
                      view={view}
                      focusRoom={focusRoom}
                    />
                    <span className="view-label">3D / SPATIAL VIEW</span>
                    <div className="scene-options">
                      <button
                        className={cut ? "active" : ""}
                        onClick={() => setCut(!cut)}
                      >
                        <Box size={14} />
                        {cut ? "剖切墙" : "全高墙"}
                      </button>
                      <button
                        onClick={() =>
                          setView((v) => (v === "top" ? "orbit" : "top"))
                        }
                      >
                        <Eye size={14} />
                        {view === "top" ? "鸟瞰" : "俯视"}
                      </button>
                      <button
                        className={walk ? "active" : ""}
                        onClick={() => setWalk(!walk)}
                      >
                        <Move size={14} />
                        {walk ? "退出漫游" : "室内漫游"}
                      </button>
                      <label>
                        <Sun size={14} />
                        <input
                          aria-label="日照时间"
                          type="range"
                          min={0}
                          max={23}
                          value={time}
                          onChange={(e) => setTime(Number(e.target.value))}
                        />
                        <span>{time}:00</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
              <div className="floating-toolbar">
                {tools.map(({ id, label, key, icon: Icon }, i) => (
                  <span key={id} className={i === 2 ? "tool-separator" : ""}>
                    <button
                      aria-label={label}
                      title={`${label} (${key})`}
                      className={tool === id ? "active" : ""}
                      disabled={mode === "3d" && id !== "select"}
                      onClick={() => setTool(id)}
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                    </button>
                  </span>
                ))}
              </div>
              <div className="canvas-bottomline">
                <span>
                  {mode === "3d"
                    ? "拖动旋转视角 · 滚轮缩放 · 选中并拖动家具"
                    : `${actualTool} · 按住空格拖动画布`}
                </span>
                <div>
                  <IconButton
                    label="缩小"
                    onClick={() => setZoom(Math.max(0.45, zoom - 0.1))}
                  >
                    <Minus size={14} />
                  </IconButton>
                  <button
                    className="zoom-value"
                    onClick={() => {
                      setZoom(1);
                      setCanvasKey((k) => k + 1);
                    }}
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <IconButton
                    label="放大"
                    onClick={() => setZoom(Math.min(3, zoom + 0.1))}
                  >
                    <Plus size={14} />
                  </IconButton>
                  <i />
                  <IconButton
                    label="适应画布 F"
                    onClick={() => {
                      setZoom(1);
                      setCanvasKey((k) => k + 1);
                      setView("orbit");
                    }}
                  >
                    <Maximize2 size={15} />
                  </IconButton>
                  <IconButton
                    label="全屏"
                    onClick={() => {
                      if (document.fullscreenElement)
                        void document.exitFullscreen();
                      else
                        void document.documentElement
                          .requestFullscreen()
                          .catch(() => notify("浏览器不支持全屏。"));
                    }}
                  >
                    <Expand size={15} />
                  </IconButton>
                </div>
              </div>
            </>
          )}
        </section>
        <aside className="inspector-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SPACE DETAILS</span>
              <h2>{selection ? "对象属性" : "空间概览"}</h2>
            </div>
            <IconButton
              label="收起属性面板"
              onClick={() => setRightOpen(false)}
            >
              <PanelRightClose size={16} />
            </IconButton>
          </div>
          <div className="inspector-scroll">
            {!project ? (
              <>
                <div className="intro-card">
                  <span className="intro-icon">
                    <Leaf size={21} />
                  </span>
                  <h3>好设计，始于了解空间</h3>
                  <p>上传户型原图，连接外部 Agent，即可开始还原和设计。</p>
                </div>
                <ol className="onboarding-list">
                  <li>
                    <b>01</b>
                    <div>
                      <strong>还原真实户型</strong>
                      <p>从图片识别墙体、房间与门窗</p>
                    </div>
                  </li>
                  <li>
                    <b>02</b>
                    <div>
                      <strong>确认结构边界</strong>
                      <p>核对尺寸，标记外墙和承重墙</p>
                    </div>
                  </li>
                  <li>
                    <b>03</b>
                    <div>
                      <strong>探索家的可能</strong>
                      <p>对话调整布局，2D / 3D 同步呈现</p>
                    </div>
                  </li>
                </ol>
                <div className="agent-card">
                  <Link2 size={18} />
                  <h3>让 Agent 参与设计</h3>
                  <p>
                    通过 MCP 连接支持看图的外部 Agent，从原图还原到布局调整。
                  </p>
                  <button
                    className="text-button"
                    onClick={() => void connect()}
                  >
                    查看连接方式
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
                {project.stage === "reconstruction" && (
                  <div className="review-card">
                    <span className="eyebrow">RESTORE & REVIEW</span>
                    <h3>先认识空间，再开始设计</h3>
                    <p>
                      {plan?.walls.length
                        ? "请对照原图确认尺寸与墙体类型。"
                        : "连接外部 Agent 读取原图，并提交结构化户型。还原完成后此处可核对结构。"}
                    </p>
                    {sourceUrl && (
                      <button
                        className="button light full"
                        onClick={() => setModal("source")}
                      >
                        <FileImage size={14} />
                        查看原始户型图
                      </button>
                    )}
                    {!!plan?.walls.length && (
                      <>
                        <div className="review-step">
                          <b className={project.calibrated ? "done" : ""}>
                            {project.calibrated ? <Check size={12} /> : 1}
                          </b>
                          <strong>核对实际尺寸</strong>
                        </div>
                        <p className="small muted">
                          确认当前模型尺寸准确，或按已知长度重新标定。
                        </p>
                        <button
                          className="button light full"
                          disabled={busy}
                          onClick={() =>
                            void run([
                              {
                                type: "calibrate",
                                measuredLength: 1,
                                actualLength: 1,
                              },
                            ])
                          }
                        >
                          {project.calibrated ? (
                            <Check size={14} />
                          ) : (
                            <Ruler size={14} />
                          )}
                          当前尺寸准确
                        </button>
                        <form
                          className="calibrate-form"
                          key={`cal-${project.id}`}
                          onSubmit={(e) => {
                            e.preventDefault();
                            const d = new FormData(e.currentTarget);
                            void run([
                              {
                                type: "calibrate",
                                measuredLength: Number(d.get("measured")),
                                actualLength: Number(d.get("actual")),
                              },
                            ]);
                          }}
                        >
                          <Field
                            name="measured"
                            label="模型长度 mm"
                            value={Math.round(bounds(project.plan).width)}
                            min={1}
                          />
                          <Field
                            name="actual"
                            label="实际长度 mm"
                            value={Math.round(bounds(project.plan).width)}
                            min={1}
                          />
                          <button className="button light full" disabled={busy}>
                            按长度重新标定
                          </button>
                        </form>
                        <div className="review-step">
                          <b
                            className={
                              project.plan.walls.every((w) => w.reviewed)
                                ? "done"
                                : ""
                            }
                          >
                            2
                          </b>
                          <strong>确认墙体类型</strong>
                        </div>
                        <p className="small muted">
                          已确认{" "}
                          {project.plan.walls.filter((w) => w.reviewed).length}{" "}
                          / {project.plan.walls.length} 段。点击墙体可纠正类型。
                        </p>
                        <button
                          className="button light full"
                          disabled={busy}
                          onClick={() => {
                            setLibraryTab("walls");
                            void run([{ type: "review_walls" }]);
                          }}
                        >
                          <ShieldCheck size={14} />
                          我已核对全部墙体
                        </button>
                        <button
                          className="button primary full"
                          disabled={busy}
                          onClick={() =>
                            void run([{ type: "confirm_structure" }]).then(
                              (ok) => {
                                if (ok) {
                                  notify("户型已确认，开始设计。");
                                  setLibraryTab("furniture");
                                  setLayers((l) => ({ ...l, source: false }));
                                }
                              },
                            )
                          }
                        >
                          进入空间设计
                          <ArrowUpRight size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )}
                {selectedWall && (
                  <div key={`${selectedWall.id}-${project.revision}`}>
                    <div className="object-title">
                      <span>
                        <Square size={17} />
                        {wallKinds[selectedWall.kind]}
                      </span>
                      <span className={`tag ${selectedWall.kind}`}>
                        {selectedWall.reviewed ? "已确认" : "待确认"}
                      </span>
                    </div>
                    <p className="object-id">{selectedWall.id}</p>
                    <label className="field">
                      <span>墙体类型（用户纠正）</span>
                      <select
                        value={selectedWall.kind}
                        disabled={busy}
                        onChange={(e) =>
                          void run([
                            {
                              type: "classify_wall",
                              wallId: selectedWall.id,
                              kind: e.target.value as Wall["kind"],
                            },
                          ])
                        }
                      >
                        {Object.entries(wallKinds).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedWall.kind !== "partition" && (
                      <div className="protected-note">
                        <LockKeyhole size={15} />
                        {selectedWall.kind === "unknown"
                          ? "确认性质前禁止拆改"
                          : "此墙体受保护，门窗可单独编辑"}
                      </div>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        void run([
                          {
                            type: "update_wall",
                            wallId: selectedWall.id,
                            a: [Number(d.get("ax")), Number(d.get("ay"))],
                            b: [Number(d.get("bx")), Number(d.get("by"))],
                            thickness: Number(d.get("thickness")),
                            height: Number(d.get("height")),
                          },
                        ]);
                      }}
                    >
                      <div className="field-grid">
                        <Field
                          name="ax"
                          label="起点 X（中心线 mm）"
                          value={Math.round(selectedWall.a[0])}
                          disabled={selectedWall.kind !== "partition"}
                        />
                        <Field
                          name="ay"
                          label="起点 Y（中心线 mm）"
                          value={Math.round(selectedWall.a[1])}
                          disabled={selectedWall.kind !== "partition"}
                        />
                        <Field
                          name="bx"
                          label="终点 X（中心线 mm）"
                          value={Math.round(selectedWall.b[0])}
                          disabled={selectedWall.kind !== "partition"}
                        />
                        <Field
                          name="by"
                          label="终点 Y（中心线 mm）"
                          value={Math.round(selectedWall.b[1])}
                          disabled={selectedWall.kind !== "partition"}
                        />
                        <Field
                          name="thickness"
                          label="厚度 mm"
                          value={selectedWall.thickness}
                          min={40}
                          max={1200}
                          disabled={selectedWall.kind !== "partition"}
                        />
                        <Field
                          name="height"
                          label="高度 mm"
                          value={selectedWall.height}
                          min={300}
                          max={6000}
                          disabled={selectedWall.kind !== "partition"}
                        />
                      </div>
                      <button
                        className="button light full"
                        disabled={
                          selectedWall.kind !== "partition" ||
                          busy ||
                          project.stage !== "design"
                        }
                      >
                        应用墙体尺寸
                      </button>
                    </form>
                    {selectedWall.kind === "partition" &&
                      project.stage === "design" && (
                        <form
                          className="partial-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const d = new FormData(e.currentTarget);
                            void run([
                              {
                                type: "remove_wall",
                                wallId: selectedWall.id,
                                from: Number(d.get("from")),
                                to: Number(d.get("to")),
                              },
                            ]).then((ok) => {
                              if (ok) setSelection(null);
                            });
                          }}
                        >
                          <h3>局部拆除</h3>
                          <p className="small muted">
                            沿墙起点计算，范围内的内墙门窗一并移除。
                          </p>
                          <div className="field-grid">
                            <Field
                              name="from"
                              label="起始 mm"
                              value={0}
                              min={0}
                            />
                            <Field
                              name="to"
                              label="结束 mm"
                              value={Math.round(wallLength(selectedWall))}
                              min={1}
                            />
                          </div>
                          <button
                            className="button danger full"
                            disabled={busy}
                          >
                            <Trash2 size={14} />
                            拆除指定墙段
                          </button>
                        </form>
                      )}
                  </div>
                )}
                {selectedFurniture && (
                  <div key={`${selectedFurniture.id}-${project.revision}`}>
                    <div className="object-title">
                      <span>
                        <Armchair size={18} />
                        {selectedFurniture.name}
                      </span>
                      <button
                        className="tiny-button"
                        onClick={() =>
                          void run([
                            {
                              type: "upsert_furniture",
                              furniture: {
                                ...selectedFurniture,
                                id: uid("f"),
                                position: [
                                  selectedFurniture.position[0] + 100,
                                  selectedFurniture.position[1] + 100,
                                ],
                              },
                            },
                          ])
                        }
                        title="复制家具"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <p className="object-id">{selectedFurniture.type}</p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        moveFurniture({
                          ...selectedFurniture,
                          name: String(d.get("name")),
                          width: Number(d.get("width")),
                          depth: Number(d.get("depth")),
                          height: Number(d.get("height")),
                          rotation: Number(d.get("rotation")),
                          position: [Number(d.get("x")), Number(d.get("y"))],
                          color: String(d.get("color")),
                        });
                      }}
                    >
                      <Field
                        name="name"
                        label="家具名称"
                        value={selectedFurniture.name}
                      />
                      <div className="field-grid">
                        {(
                          [
                            ["width", "宽度 mm"],
                            ["depth", "深度 mm"],
                            ["height", "高度 mm"],
                            ["rotation", "旋转角度 °"],
                          ] as const
                        ).map(([k, label]) => (
                          <Field
                            key={k}
                            name={k}
                            label={label}
                            value={selectedFurniture[k]}
                            min={k === "rotation" ? -3600 : 10}
                            step={k === "rotation" ? 1 : 10}
                          />
                        ))}
                        <Field
                          name="x"
                          label="位置 X"
                          value={Math.round(selectedFurniture.position[0])}
                        />
                        <Field
                          name="y"
                          label="位置 Y"
                          value={Math.round(selectedFurniture.position[1])}
                        />
                      </div>
                      <label className="field color-field">
                        <span>材质颜色</span>
                        <input
                          type="color"
                          name="color"
                          defaultValue={selectedFurniture.color}
                        />
                      </label>
                      <button className="button light full" disabled={busy}>
                        应用家具属性
                      </button>
                    </form>
                    <div className="two-buttons">
                      <button
                        className="button light"
                        disabled={busy}
                        onClick={() =>
                          moveFurniture({
                            ...selectedFurniture,
                            rotation: selectedFurniture.rotation + 90,
                          })
                        }
                      >
                        <RotateCw size={14} />
                        旋转 90°
                      </button>
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={deleteSelection}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </div>
                )}
                {selectedOpening && (
                  <OpeningInspector
                    key={`${selectedOpening.id}-${project.revision}`}
                    opening={selectedOpening}
                    walls={project.plan.walls}
                    wall={project.plan.walls.find(
                      (w) => w.id === selectedOpening.wallId,
                    )!}
                    busy={busy}
                    run={run}
                    onDelete={deleteSelection}
                  />
                )}
                {selectedRoom && (
                  <div key={`${selectedRoom.id}-${project.revision}`}>
                    <div className="object-title">
                      <span>
                        <Grid2X2 size={17} />
                        {selectedRoom.name}
                      </span>
                      <span>{roomArea(selectedRoom).toFixed(1)} m²</span>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        void run([
                          {
                            type: "update_room",
                            roomId: selectedRoom.id,
                            name: String(d.get("name")),
                            material: d.get(
                              "material",
                            ) as typeof selectedRoom.material,
                          },
                        ]);
                      }}
                    >
                      <Field
                        name="name"
                        label="空间名称"
                        value={selectedRoom.name}
                      />
                      <label className="field">
                        <span>地面材质</span>
                        <select
                          name="material"
                          defaultValue={selectedRoom.material}
                        >
                          {Object.entries(materials).map(([k, m]) => (
                            <option value={k} key={k}>
                              {m.name} · ¥{m.price}/m²
                            </option>
                          ))}
                        </select>
                      </label>
                      <div
                        className="material-preview"
                        style={{
                          background: materials[selectedRoom.material].color,
                        }}
                      />
                      <button className="button light full" disabled={busy}>
                        应用空间设置
                      </button>
                    </form>
                    <div className="cost-row">
                      <span>地面预算</span>
                      <strong>
                        ¥
                        {Math.round(
                          roomArea(selectedRoom) *
                            materials[selectedRoom.material].price *
                            1.05,
                        ).toLocaleString()}
                      </strong>
                    </div>
                    <p className="small muted">
                      按面积 × 材料单价，含 5% 损耗，仅为材料估算。
                    </p>
                  </div>
                )}
                {!selectedWall &&
                  !selectedFurniture &&
                  !selectedOpening &&
                  !selectedRoom && (
                    <>
                      <div className="area-card">
                        <span>套内使用面积</span>
                        <strong>
                          {totalArea.toFixed(1)}
                          <small>m²</small>
                        </strong>
                        <div>
                          <span>{plan?.rooms.length ?? 0} 个空间</span>
                          <span>{plan?.furniture.length ?? 0} 件家具</span>
                        </div>
                      </div>
                      <div className="section-title">
                        <h3>空间清单</h3>
                        <span>{plan?.rooms.length ?? 0}</span>
                      </div>
                      <div className="room-list">
                        {plan?.rooms.map((r, i) => (
                          <button
                            key={r.id}
                            onClick={() => {
                              setSelection({ kind: "room", id: r.id });
                              setFocusRoom(r.id);
                            }}
                          >
                            <span className="room-number">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span>
                              {r.name}
                              <small>{materials[r.material].name}</small>
                            </span>
                            <strong>
                              {roomArea(r).toFixed(1)}
                              <small> m²</small>
                            </strong>
                            <ChevronRight size={13} />
                          </button>
                        ))}
                      </div>
                      <div className="cost-row">
                        <span>地面材料估算</span>
                        <strong>¥{Math.round(cost).toLocaleString()}</strong>
                      </div>
                      <p className="small muted">
                        含 5% 材料损耗，不包含施工费用。
                      </p>
                      <div className="protection-card">
                        <ShieldCheck size={18} />
                        <div>
                          <strong>结构保护已启用</strong>
                          <p>
                            外墙固定 · 门窗可手动调整
                            <br />
                            承重墙禁止拆改
                          </p>
                        </div>
                        <LockKeyhole size={13} />
                      </div>
                    </>
                  )}
                {!!project.activity.length && (
                  <div className="activity-section">
                    <h3>
                      <History size={14} />
                      最近操作
                    </h3>
                    {project.activity.slice(0, 3).map((a, i) => (
                      <div className="activity-row" key={`${a.at}-${i}`}>
                        <span className={`activity-dot ${a.actor}`} />
                        <div>
                          {a.text}
                          <small>
                            {a.actor === "agent" ? "外部 Agent" : "手动操作"} ·{" "}
                            {new Date(a.at).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="inspector-footer">
            <span className="status-dot" />
            {online ? "本地服务已就绪" : "正在连接本地服务"}
            <span>{project ? `v${project.revision}` : "MCP READY"}</span>
          </div>
        </aside>
      </div>
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => void importJson(e.target.files?.[0])}
      />
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            className={`modal modal-${modal}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "new"
                ? "新建项目"
                : modal === "mcp"
                  ? "连接外部 Agent"
                  : modal === "source"
                    ? "户型原图"
                    : "使用指南"
            }
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭弹窗"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === "new" && (
              <>
                <span className="eyebrow">NEW BEGINNING</span>
                <h2>把家的第一张图，放进来。</h2>
                <p className="muted">
                  上传清晰的户型图片，开启一个新的设计项目。
                </p>
                <label className="field">
                  <span>项目名称</span>
                  <input
                    value={projectName}
                    maxLength={80}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </label>
                <button
                  className={`upload-area ${file ? "has-file" : ""}`}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    acceptFile(e.dataTransfer.files[0]);
                  }}
                >
                  <ImagePlus size={31} />
                  <strong>
                    {file ? file.name : "点击上传，或将户型图拖到这里"}
                  </strong>
                  <span>
                    {file
                      ? `${(file.size / 1024 / 1024).toFixed(2)} MB · 点击更换`
                      : "支持 PNG / JPG / WebP，最大 10 MB"}
                  </span>
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => acceptFile(e.target.files?.[0])}
                />
                <div className="quiet-note">
                  <ShieldCheck size={14} />
                  原图仅保存在本机。识别结果需经你核对后才能开始设计。
                </div>
                <button
                  className="button primary full large"
                  disabled={busy || !file || !projectName.trim()}
                  onClick={() => void create()}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Plus size={16} />
                  )}
                  创建项目
                </button>
              </>
            )}
            {modal === "mcp" && (
              <>
                <span className="eyebrow">BRING YOUR OWN AGENT</span>
                <h2>连接你的设计搭档</h2>
                <p className="muted">
                  把下面的 MCP 配置添加到支持 MCP 的外部 Agent
                  客户端。保持本项目服务运行即可。
                </p>
                <div className="mcp-flow">
                  <span>
                    <Link2 size={18} />
                    外部 Agent
                  </span>
                  <ChevronRight size={15} />
                  <span>
                    <ShieldCheck size={18} />
                    设计工具
                  </span>
                  <ChevronRight size={15} />
                  <span>
                    <Box size={18} />
                    2D / 3D 同步
                  </span>
                </div>
                <div className="code-heading">
                  <span>MCP 配置 · stdio</span>
                  <button
                    className="text-button"
                    disabled={!mcpConfig}
                    onClick={() => void copy(mcpConfig)}
                  >
                    <Copy size={13} />
                    复制配置
                  </button>
                </div>
                <pre className="config-code">
                  {mcpConfig || "正在获取本机配置…"}
                </pre>
                <h3>连接后，可以这样说</h3>
                <div className="prompt-example">
                  {project
                    ? `读取项目 ${project.id}。${project.stage === "reconstruction" ? "查看原始户型图片，还原墙体、门窗和房间。标记不确定的墙体，等待我在网页核对尺寸与类型。" : "读取当前布局，在保留外墙、外墙门窗和承重墙的前提下，帮我优化客餐厅家具布置。"}`
                    : "列出筑间的项目，读取我上传的户型原图，还原布局并等待我核对结构。"}
                </div>
                <p className="small muted">
                  户型识别需要外部 Agent
                  支持图片理解。网页不包含聊天助手，也不需要配置模型密钥。修改约每
                  2 秒同步到画布。
                </p>
              </>
            )}
            {modal === "source" && (
              <>
                <span className="eyebrow">ORIGINAL FLOOR PLAN</span>
                <h2>{project?.source?.name}</h2>
                <div className="source-image">
                  {sourceUrl && (
                    <img src={sourceUrl} alt="用户上传的原始户型图" />
                  )}
                </div>
                <p className="small muted">
                  {project?.source?.width} × {project?.source?.height} px ·
                  请以原图尺寸标注核对模型
                </p>
              </>
            )}
            {modal === "help" && (
              <>
                <span className="eyebrow">MAKE ROOM FOR IDEAS</span>
                <h2>你的空间设计工作台</h2>
                <ol className="help-list">
                  <li>上传户型图片，点击「连接 Agent」获取 MCP 配置。</li>
                  <li>让支持视觉的外部 Agent 读取原图、提交还原户型。</li>
                  <li>
                    核对实际尺寸，并确认每段墙体是外墙、承重墙或非承重墙。
                  </li>
                  <li>进入设计阶段，手动编辑或在外部 Agent 中对话调整布局。</li>
                  <li>在 2D / 3D / 双视图间切换，导出 PNG 或完整 JSON。</li>
                </ol>
                <div className="shortcut-grid">
                  <span>V / H</span>
                  <span>选择 / 平移</span>
                  <span>空格 + 拖动</span>
                  <span>临时平移画布</span>
                  <span>Shift + 绘墙</span>
                  <span>按方向保持水平 / 垂直</span>
                  <span>W / D / O</span>
                  <span>新墙 / 门洞 / 窗洞</span>
                  <span>M / T</span>
                  <span>测量 / 切换 2D、3D</span>
                  <span>R / Shift + R</span>
                  <span>家具旋转 ±90°</span>
                  <span>⌘ / Ctrl + Z</span>
                  <span>撤销（Shift 重做）</span>
                  <span>Delete / F</span>
                  <span>删除 / 适应画布</span>
                </div>
                <p className="quiet-note">
                  外墙和承重墙的墙体受保护；用户可调整或删除所有门窗。只有用户可以纠正墙体类型；Agent
                  无权解除保护。方案导入会建立新项目，并要求重新核对墙体。
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
function OpeningInspector({
  opening: o,
  wall,
  walls,
  busy,
  run,
  onDelete,
}: {
  opening: Opening;
  wall: Wall;
  walls: Wall[];
  busy: boolean;
  run: (c: Command[]) => Promise<boolean>;
  onDelete: () => void;
}) {
  const savedType = getOpeningType(o);
  const [type, setType] = useState<OpeningType>(savedType);
  return (
    <div>
      <div className="object-title">
        <span>
          <DoorOpen size={18} />
          {savedType === "passage"
            ? "过道"
            : o.kind === "door"
              ? "门洞"
              : "窗洞"}
        </span>
      </div>
      <p className="object-id">
        {o.id} · {wallKinds[wall.kind]}
      </p>
      <p className="quiet-note">
        可手动调整或删除此门窗，墙体本身的保护规则保持有效。
      </p>
      {savedType === "door" && (
        <button
          type="button"
          className="button light full"
          disabled={busy}
          onClick={() =>
            void run([
              {
                type: "upsert_opening",
                opening: withOpeningType(o, "passage"),
              },
            ])
          }
        >
          <DoorOpen size={15} />
          移除门扇，改为过道
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void run([
            {
              type: "upsert_opening",
              opening: withOpeningType(
                {
                  ...o,
                  wallId: String(d.get("wallId")),
                  offset: Number(d.get("offset")),
                  width: Number(d.get("width")),
                  height: Number(d.get("height")),
                  sill: Number(d.get("sill")),
                  swing: (d.get("swing") ?? o.swing) as Opening["swing"],
                  doorStyle: (d.get("doorStyle") ||
                    undefined) as Opening["doorStyle"],
                },
                type,
              ),
            },
          ]);
        }}
      >
        <label className="field">
          <span>所在墙体</span>
          <select name="wallId" defaultValue={o.wallId}>
            {walls.map((w) => (
              <option key={w.id} value={w.id}>
                {wallKinds[w.kind]} · {w.id} · {Math.round(wallLength(w))} mm
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>洞口类型</span>
          <select
            name="kind"
            value={type}
            onChange={(e) => setType(e.target.value as OpeningType)}
          >
            <option value="door">门洞</option>
            <option value="window">窗洞</option>
            <option value="passage">过道（无门扇）</option>
          </select>
        </label>
        <div className="field-grid">
          <Field
            name="offset"
            label="距墙起点 mm"
            value={Math.round(o.offset)}
            min={0}
          />
          <Field name="width" label="洞口宽度 mm" value={o.width} min={200} />
          <Field name="height" label="洞口高度 mm" value={o.height} min={200} />
          {type !== "passage" && (
            <Field name="sill" label="底部标高 mm" value={o.sill} min={0} />
          )}
        </div>
        {type === "door" ? (
          <>
            <label className="field">
              <span>门型</span>
              <select
                name="doorStyle"
                defaultValue={
                  o.doorStyle === "opening" ? "" : (o.doorStyle ?? "")
                }
              >
                <option value="">按宽度显示：≤1200 mm 单扇，宽洞口推拉</option>
                {Object.entries(doorStyleNames)
                  .filter(([value]) => value !== "opening")
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>平开门铰链方向</span>
              <select name="swing" defaultValue={o.swing}>
                <option value="left">左侧铰链</option>
                <option value="right">右侧铰链</option>
              </select>
            </label>
          </>
        ) : type === "passage" ? (
          <p className="quiet-note">
            过道保留洞口尺寸与位置，移除门扇，底部与地面齐平，可直接通行。
          </p>
        ) : null}
        <button className="button light full" disabled={busy}>
          应用洞口设置
        </button>
      </form>
      <button className="button danger full" disabled={busy} onClick={onDelete}>
        <Trash2 size={14} />
        删除洞口并补回墙体
      </button>
    </div>
  );
}
function MiniPlan() {
  const p = demoPlan();
  return (
    <svg viewBox="-800 -800 13600 10600" aria-hidden="true">
      {p.rooms.map((r) => (
        <polygon
          key={r.id}
          points={r.polygon.map((p) => p.join(",")).join(" ")}
          fill={materials[r.material].color}
        />
      ))}
      {p.furniture.map((f) => (
        <g
          key={f.id}
          transform={`translate(${f.position}) rotate(${f.rotation})`}
        >
          <FurnitureShape item={f} />
        </g>
      ))}
      {p.walls.map((w) => (
        <path
          key={w.id}
          d={`M${w.a}L${w.b}`}
          stroke="#66735d"
          strokeWidth={w.thickness}
          fill="none"
        />
      ))}
    </svg>
  );
}
function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
