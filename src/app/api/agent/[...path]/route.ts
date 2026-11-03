import {
  createProject,
  exportProject,
  getProject,
  inspectImage,
  listProjects,
  mutateProject,
  sourceImage,
} from "@/server/store";
import { errorResponse, limitedJson, requireAgent } from "@/server/http";
import { batchSchema } from "@/domain/schema";
import { RuleError } from "@/domain/engine";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, { params }: Context) {
  try {
    await requireAgent(request);
    const p = (await params).path;
    if (p[0] !== "projects")
      throw new RuleError("NOT_FOUND", "接口不存在。", 404);
    if (p.length === 1) return Response.json(await listProjects());
    if (p.length === 2) {
      const value = await getProject(p[1]);
      const { history: _, future: __, ...rest } = value;
      return Response.json(rest);
    }
    if (p.length === 3 && p[2] === "source") {
      const s = await sourceImage(p[1]);
      return Response.json({ ...s.meta, data: s.data.toString("base64") });
    }
    if (p.length === 3 && p[2] === "export")
      return Response.json(await exportProject(p[1]));
    throw new RuleError("NOT_FOUND", "接口不存在。", 404);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    await requireAgent(request);
    const p = (await params).path;
    if (p.length === 1 && p[0] === "projects") {
      const { z } = await import("zod");
      const b = z
        .object({
          name: z.string().min(1).max(80),
          imageBase64: z.string().max(14000000),
          imageName: z.string().max(150).default("floorplan.png"),
        })
        .parse(await limitedJson(request));
      const source = await inspectImage(
        Buffer.from(b.imageBase64, "base64"),
        b.imageName,
      );
      const result = await createProject(b.name, source);
      return Response.json(
        {
          id: result.id,
          name: result.name,
          revision: result.revision,
          stage: result.stage,
        },
        { status: 201 },
      );
    }
    if (p.length === 3 && p[0] === "projects" && p[2] === "commands") {
      const b = batchSchema.parse(await limitedJson(request));
      const value = await mutateProject(
        p[1],
        b.expectedRevision,
        b.commands,
        "agent",
      );
      const { history: _, future: __, ...rest } = value;
      return Response.json(rest);
    }
    throw new RuleError("NOT_FOUND", "接口不存在。", 404);
  } catch (e) {
    return errorResponse(e);
  }
}
