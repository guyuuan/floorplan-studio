import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "筑间 · Floorplan Studio",
  description:
    "从户型原图到理想生活。支持外部 Agent MCP 操作的 2D / 3D 户型设计工作台。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
