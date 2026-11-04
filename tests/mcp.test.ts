import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/create-server";
import { createAgentApi } from "../src/server/agent-api";
import { ProjectService } from "../src/server/store";
import { LocalRepository } from "../src/server/repositories/local";
test("shared MCP tools call the project service directly and cannot perform user-only review", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "floorplan-mcp-direct-"),
  );
  const service = new ProjectService(new LocalRepository(directory)),
    project = await service.createProject("direct service", undefined, true);
  const server = createMcpServer(createAgentApi(service)),
    client = new Client({ name: "test", version: "1" }),
    [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    assert.equal((await client.listTools()).tools.length, 8);
    const result = await client.callTool({
      name: "get_project",
      arguments: { projectId: project.id },
    });
    assert.ok(!result.isError);
    const denied = await client.callTool({
      name: "apply_design_commands",
      arguments: {
        projectId: project.id,
        expectedRevision: 0,
        commands: [
          { type: "classify_wall", wallId: "ext_n", kind: "partition" },
        ],
      },
    });
    assert.equal(denied.isError, true);
    assert.equal((await service.getProject(project.id)).revision, 0);
    const entry = project.plan.openings.find((o) => o.id === "entry")!;
    const lockedOpening = await client.callTool({
      name: "apply_design_commands",
      arguments: {
        projectId: project.id,
        expectedRevision: 0,
        commands: [{ type: "delete_opening", openingId: entry.id }],
      },
    });
    assert.equal(lockedOpening.isError, true);
    const door = project.plan.openings.find((o) => o.id === "study_door")!;
    const invalidWidth = await client.callTool({
      name: "apply_design_commands",
      arguments: {
        projectId: project.id,
        expectedRevision: 0,
        commands: [
          { type: "upsert_opening", opening: { ...door, width: 1600 } },
        ],
      },
    });
    assert.equal(invalidWidth.isError, true);
    assert.match(
      JSON.stringify(invalidWidth.content),
      /DOOR_WIDTH_REVIEW_REQUIRED|明确/,
    );
    assert.equal((await service.getProject(project.id)).revision, 0);
    const corrected = await client.callTool({
      name: "apply_design_commands",
      arguments: {
        projectId: project.id,
        expectedRevision: 0,
        commands: [
          {
            type: "upsert_opening",
            opening: { ...door, width: 1600, doorStyle: "double" },
          },
        ],
      },
    });
    assert.ok(!corrected.isError, JSON.stringify(corrected.content));
    assert.equal(
      (await service.getProject(project.id)).plan.openings.find(
        (o) => o.id === door.id,
      )!.doorStyle,
      "double",
    );
  } finally {
    await client.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
