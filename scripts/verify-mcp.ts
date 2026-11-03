import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { demoPlan } from "../src/domain/demo";
import { dataDirectory } from "../src/server/store";

// Runs against the project's existing local Next.js server; all created fixtures are removed.
const base = process.env.FLOORPLAN_API_URL ?? "http://127.0.0.1:3000";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/mcp/server.ts"],
  cwd: process.cwd(),
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    FLOORPLAN_API_URL: base,
    FLOORPLAN_DATA_DIR: dataDirectory,
  },
});
const client = new Client({ name: "floorplan-verification", version: "1.0.0" });
let projectId: string | undefined;
const fixtureIds: string[] = [];
const call = async (name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args });
const parsed = (r: Awaited<ReturnType<typeof call>>) => {
  assert.ok(!r.isError, JSON.stringify(r.content));
  return JSON.parse((r.content as { type: string; text: string }[])[0].text);
};
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 8);
  const image = await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#f4f2e9" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("name", "Browser upload integration fixture");
  form.set(
    "image",
    new File([new Uint8Array(image)], "fixture.png", { type: "image/png" }),
  );
  const upload = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { origin: base },
    body: form,
  });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  fixtureIds.push(uploaded.id);
  assert.equal(uploaded.source.width, 100);
  const preview = await fetch(`${base}/api/projects/${uploaded.id}/png`, {
    method: "POST",
    headers: { origin: base, "content-type": "image/png" },
    body: new Uint8Array(image),
  });
  assert.equal(preview.status, 200);
  const png = await fetch(`${base}/api/projects/${uploaded.id}/png`);
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), image);
  const created = parsed(
    await call("create_project", {
      name: "MCP integration fixture",
      imageBase64: image.toString("base64"),
      imageName: "fixture.png",
    }),
  );
  projectId = created.id;
  fixtureIds.push(projectId!);
  const source = await call("get_source_image", { projectId });
  assert.ok(!source.isError);
  assert.ok(
    (source.content as { type: string }[]).some((c) => c.type === "image"),
  );
  const p = demoPlan();
  p.furniture = [];
  let current = parsed(
    await call("restore_floorplan", {
      projectId,
      expectedRevision: 0,
      plan: p,
    }),
  );
  assert.equal(current.stage, "reconstruction");
  assert.ok(
    current.plan.walls.every((w: { reviewed: boolean }) => !w.reviewed),
  );
  const bypass = await call("apply_design_commands", {
    projectId,
    expectedRevision: current.revision,
    commands: [{ type: "review_walls" }, { type: "confirm_structure" }],
  });
  assert.equal(bypass.isError, true);
  const approval = await fetch(`${base}/api/projects/${projectId}/commands`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: current.revision,
      commands: [
        { type: "calibrate", measuredLength: 1, actualLength: 1 },
        { type: "review_walls" },
        { type: "confirm_structure" },
      ],
    }),
  });
  assert.equal(approval.status, 200);
  current = await approval.json();
  const locked = await call("apply_design_commands", {
    projectId,
    expectedRevision: current.revision,
    commands: [{ type: "remove_wall", wallId: "ext_n" }],
  });
  assert.equal(locked.isError, true);
  const safe = await call("apply_design_commands", {
    projectId,
    expectedRevision: current.revision,
    commands: [{ type: "update_wall", wallId: "kitchen_wall", thickness: 140 }],
  });
  current = parsed(safe);
  assert.equal(
    current.plan.walls.find((w: { id: string }) => w.id === "kitchen_wall")
      .thickness,
    140,
  );
  const conflict = await call("apply_design_commands", {
    projectId,
    expectedRevision: 0,
    commands: [{ type: "remove_wall", wallId: "middle" }],
  });
  assert.equal(conflict.isError, true);
  const bundle = parsed(await call("export_project_json", { projectId }));
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.image.width, 100);
  assert.equal(bundle.plan.walls.length, 8);
  const denied = await fetch(`${base}/api/agent/projects`);
  assert.equal(denied.status, 401);
  console.log(
    "MCP integration passed: discovery, image read, restoration, user review, protected walls, edits, revision conflicts, export, authentication.",
  );
} finally {
  await client.close();
  await Promise.all(
    fixtureIds.flatMap((id) =>
      ["json", "image", "export.png"].map((ext) =>
        rm(path.join(dataDirectory, `${id}.${ext}`), { force: true }),
      ),
    ),
  );
}
