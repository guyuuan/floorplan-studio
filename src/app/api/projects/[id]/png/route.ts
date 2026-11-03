import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, getProject, inspectImage } from "@/server/store";
import { errorResponse, requireBrowser } from "@/server/http";
import { RuleError } from "@/domain/engine";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    requireBrowser(request);
    const p = await getProject((await params).id);
    const reader = request.body?.getReader();
    if (!reader) throw new RuleError("EMPTY_BODY", "PNG 内容为空。", 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 10 * 1024 * 1024) {
        await reader.cancel();
        throw new RuleError("TOO_LARGE", "PNG 不能超过 10 MB。", 413);
      }
      chunks.push(value);
    }
    const data = Buffer.concat(chunks),
      image = await inspectImage(data, "export.png");
    if (image.mime !== "image/png")
      throw new RuleError("INVALID_IMAGE", "仅接受 PNG 导出内容。", 400);
    const target = path.join(dataDirectory, `${p.id}.export.png`),
      temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, target);
    return Response.json({ ok: true, url: `/api/projects/${p.id}/png` });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(_: Request, { params }: Context) {
  try {
    const p = await getProject((await params).id);
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(dataDirectory, `${p.id}.export.png`));
    } catch {
      throw new RuleError("NOT_FOUND", "请先在网页生成 PNG。", 404);
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="floorplan.png"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
