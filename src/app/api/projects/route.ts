import { requireUser } from "@/server/auth";
import { getProjectService, inspectImage } from "@/server/store";
import { errorResponse, requireBrowser } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const identity = await requireUser(request);
    return Response.json(
      await (await getProjectService(identity?.userId)).listProjects(),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const identity = await requireBrowser(request);
    const data = await request.formData();
    const name = String(data.get("name") ?? "我的户型");
    const demo = data.get("demo") === "true";
    const file = data.get("image");
    let image;
    if (file instanceof File) {
      if (file.size > 10 * 1024 * 1024)
        return Response.json(
          { error: "图片不能超过 10 MB。" },
          { status: 413 },
        );
      image = await inspectImage(
        Buffer.from(await file.arrayBuffer()),
        file.name,
      );
    }
    if (!demo && !image)
      return Response.json({ error: "请上传户型图片。" }, { status: 400 });
    return Response.json(
      await (
        await getProjectService(identity?.userId)
      ).createProject(name, image, demo),
      {
        status: 201,
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
