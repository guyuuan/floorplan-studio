import { token } from "@/server/store";
export const dynamic = "force-dynamic";
export async function GET() {
  await token();
  return Response.json({
    ok: true,
    mode: "local",
    mcp: "stdio",
    assistant: false,
  });
}
