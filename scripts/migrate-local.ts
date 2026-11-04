import path from "node:path";
import { LocalRepository } from "../src/server/repositories/local";

const args = new Set(process.argv.slice(2)),
  apply = args.has("--apply");
const directory = path.resolve(process.env.FLOORPLAN_DATA_DIR ?? ".data"),
  repository = new LocalRepository(directory),
  projects = await repository.list();
console.log(
  `待迁移 ${projects.length} 个项目。${apply ? "开始上传到指定站点。" : "当前为预览模式，不会向线上写入。"}`,
);
if (!apply) {
  for (const project of projects)
    console.log(`${project.id} · revision ${project.revision}`);
  console.log("确认目标站点及环境变量后，使用 --apply 执行。");
  process.exit(0);
}
if (
  !process.env.APP_ORIGIN ||
  !process.env.APP_USERNAME ||
  !process.env.APP_PASSWORD
)
  throw new Error(
    "请通过环境变量配置 APP_ORIGIN、APP_USERNAME、APP_PASSWORD。",
  );
const origin = new URL(process.env.APP_ORIGIN).origin;
if (
  !origin.startsWith("https://") &&
  !["http://127.0.0.1:8788", "http://127.0.0.1:8787"].includes(origin)
)
  throw new Error("迁移目标必须使用 HTTPS。");
const login = await fetch(`${origin}/api/auth/login`, {
  method: "POST",
  headers: { origin, "content-type": "application/json" },
  body: JSON.stringify({
    username: process.env.APP_USERNAME,
    password: process.env.APP_PASSWORD,
  }),
});
if (!login.ok) throw new Error(`登录失败（${login.status}），没有迁移数据。`);
const cookie = login.headers.get("set-cookie")?.split(";")[0],
  session = await login.json();
if (!cookie || !session.csrf) throw new Error("迁移目标必须启用登录。");
for (const summary of projects) {
  const existing = await fetch(`${origin}/api/projects/${summary.id}`, {
    headers: { cookie },
  });
  if (existing.ok) {
    console.log(`跳过已有项目 ${summary.id}（不覆盖）`);
    continue;
  }
  if (existing.status !== 404)
    throw new Error(`无法检查项目 ${summary.id}（${existing.status}）`);
  const project = await repository.get(summary.id),
    imageBase64 = project.source
      ? Buffer.from(await repository.getBinary(project.id, "source")).toString(
          "base64",
        )
      : undefined;
  const response = await fetch(`${origin}/api/migrate`, {
    method: "POST",
    headers: {
      origin,
      cookie,
      "x-floorplan-csrf": session.csrf,
      "content-type": "application/json",
    },
    body: JSON.stringify({ project, imageBase64 }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `迁移 ${project.id} 失败：${error.error ?? response.status}`,
    );
  }
  try {
    const png = await repository.getBinary(project.id, "png");
    const preview = await fetch(`${origin}/api/projects/${project.id}/png`, {
      method: "POST",
      headers: {
        origin,
        cookie,
        "x-floorplan-csrf": session.csrf,
        "content-type": "image/png",
      },
      body: new Uint8Array(png),
    });
    if (!preview.ok)
      console.warn(`项目 ${project.id} 的 PNG 可在网页重新生成。`);
  } catch {
    /* A saved preview is optional; the project itself has been migrated. */
  }
  console.log(`已迁移 ${project.id} · revision ${project.revision}`);
}
console.log("迁移完成。本机原始目录保留不变，本地 MCP 凭据不会上传。");
