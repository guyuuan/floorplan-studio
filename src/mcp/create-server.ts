import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { commandSchema, planSchema } from "../domain/schema";
import { catalog } from "../domain/catalog";
const doorGuidance =
  "门宽须依据原图标注或可靠比例及洞口两端计算，width 为洞口总宽，不是单扇门宽；不能把整段阳台边界当门。超过 1200 mm 必须核对并明确 doorStyle：double（双扇）、sliding（推拉）或 opening（无门扇）；single 单扇及 double 每扇不超过 1200 mm。门型、宽度或是否有门扇无法确认时先询问用户，不得猜测。";
export type McpApi = (path: string, body?: unknown) => Promise<any>;

export function createMcpServer(api: McpApi) {
  const server = new McpServer({ name: "floorplan-studio", version: "0.2.0" });
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });
  const safe = (fn: () => Promise<ReturnType<typeof result>>) =>
    fn().catch((e) => ({
      isError: true,
      content: [
        {
          type: "text" as const,
          text: e instanceof Error ? e.message : String(e),
        },
      ],
    }));
  server.registerTool(
    "list_projects",
    {
      description:
        "列出项目，获得 projectId、阶段和最新修订号。用户通常先在网页上传户型图片。",
      inputSchema: {},
    },
    () => safe(async () => result(await api("projects"))),
  );
  server.registerTool(
    "create_project",
    {
      description:
        "从 PNG/JPG/WebP 原图建立待还原项目。也可让用户通过网页上传，避免在提示词中传输大段 Base64。",
      inputSchema: {
        name: z.string(),
        imageBase64: z.string(),
        imageName: z.string().default("floorplan.png"),
      },
    },
    (args) => safe(async () => result(await api("projects", args))),
  );
  server.registerTool(
    "get_project",
    {
      description:
        "读取完整当前户型、家具、墙体确认状态与 revision。修改前必读；所有长度单位 mm。",
      inputSchema: { projectId: z.string() },
    },
    (args) =>
      safe(async () =>
        result(await api(`projects/${encodeURIComponent(args.projectId)}`)),
      ),
  );
  server.registerTool(
    "get_source_image",
    {
      description:
        "获取用户上传的户型原图作为图像内容。由支持视觉的外部 Agent 识别墙体、门窗及尺寸；不能仅凭粗线判断承重。",
      inputSchema: { projectId: z.string() },
    },
    async (args) => {
      try {
        const s = await api(
          `projects/${encodeURIComponent(args.projectId)}/source`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `${s.name}, ${s.width}×${s.height} px。请保持原图方向。${doorGuidance}`,
            },
            { type: "image" as const, mimeType: s.mime, data: s.data },
          ],
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: String(e) }],
        };
      }
    },
  );
  server.registerTool(
    "restore_floorplan",
    {
      description:
        doorGuidance +
        "仅在 reconstruction 阶段提交完整还原户型。坐标/宽度单位 mm；boundary 为建筑外皮闭合轮廓（不重复首点），墙端点为墙厚中心线坐标，不能用墙皮角点。新墙端点会按现有墙面自动贴合，实体不得交叉或重叠；新增后先读取返回的实际端点，再按实际起点定位门窗。墙体 reviewed 会强制置为 false。承重不明确用 unknown，外墙用 exterior；不要编造尺寸，缺少可靠尺寸时向用户询问。家具可留空。房间由墙体自动计算，传入 room 多边形可保留命名和材质。提交后等待用户在网页标定并确认；Agent 无权确认或改变墙体类别。",
      inputSchema: {
        projectId: z.string(),
        expectedRevision: z.number().int(),
        plan: planSchema,
      },
    },
    (args) =>
      safe(async () =>
        result(
          await api(`projects/${encodeURIComponent(args.projectId)}/commands`, {
            expectedRevision: args.expectedRevision,
            commands: [{ type: "restore_plan", plan: args.plan }],
          }),
        ),
      ),
  );
  server.registerTool(
    "apply_design_commands",
    {
      description:
        doorGuidance +
        "原子执行设计操作；任何一项失败则整批不保存。Agent 仅允许修改已确认的非承重内墙及其门窗；外墙、承重墙和其门窗对 Agent 锁定。用户可在网页手动修改或删除任何门窗。Agent 不能改墙体类别或撤销用户确认。add_wall/update_wall 的 a/b 使用墙厚中心线坐标，端头按实际墙面贴合，禁止实体交叉重叠；新增后按返回的实际起点定位门窗。remove_wall 的 from/to 为沿墙起点计的 mm。家具使用 catalog 类型。revision 冲突后重新读项目并按最新状态重新规划，禁止盲目重放。",
      inputSchema: {
        projectId: z.string(),
        expectedRevision: z.number().int(),
        commands: z.array(commandSchema).min(1).max(100),
      },
    },
    (args) =>
      safe(async () =>
        result(
          await api(`projects/${encodeURIComponent(args.projectId)}/commands`, {
            expectedRevision: args.expectedRevision,
            commands: args.commands,
          }),
        ),
      ),
  );
  server.registerTool(
    "get_furniture_catalog",
    {
      description: "读取家具库类型、默认尺寸与颜色，用于生成合理家具布置。",
      inputSchema: {},
    },
    () => result(catalog),
  );
  server.registerTool(
    "export_project_json",
    {
      description:
        "导出完整可恢复的方案 JSON，包含原图、几何数据和材质。PNG 可在网页导出。",
      inputSchema: { projectId: z.string() },
    },
    (args) =>
      safe(async () =>
        result(
          await api(`projects/${encodeURIComponent(args.projectId)}/export`),
        ),
      ),
  );
  server.registerResource(
    "workflow",
    "floorplan://workflow",
    { mimeType: "text/plain", description: "还原与设计工作流、墙体规则" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text:
            doorGuidance +
            "上传图片 → get_source_image → 识别并还原 mm 坐标 → restore_floorplan → 用户在网页核对尺寸、墙体类型并进入 design → get_project → apply_design_commands。外墙与承重墙的墙体固定；用户可在还原与设计阶段调整所有门窗；Agent 不可改外墙及承重墙的门窗；非承重内墙允许局部拆除、移动、改厚度、增删移动门窗。Agent 不得修改墙体分类、确认结构或使用用户撤销功能。2D/3D 共用模型，无需分别创建两个布局。网页每 2 秒同步持久化状态。不包含内置聊天助手。",
        },
      ],
    }),
  );
  return server;
}
