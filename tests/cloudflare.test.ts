import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { CloudflareRepository } from "../src/server/repositories/cloudflare";
import { ProjectService, inspectImage } from "../src/server/store";
import { applyCommands, RuleError } from "../src/domain/engine";
import { migrateProject } from "../src/server/migration";

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-11-03",
    d1Databases: { DB: "test-floorplan" },
    r2Buckets: ["FILES"],
  }),
);
const db = (await mf.getD1Database("DB")) as unknown as D1Database,
  files = (await mf.getR2Bucket("FILES")) as unknown as R2Bucket;
for (const file of [
  "0001_cloud_storage.sql",
  "0002_user_mcp_tokens.sql",
  "0003_multi_user.sql",
]) {
  await db.exec(
    (await readFile(`migrations/${file}`, "utf8")).replace(/\n/g, " "),
  );
}
const repository = () => new CloudflareRepository(db, files, "test-owner"),
  service = () => new ProjectService(repository());
after(() => mf.dispose());

test("real D1/R2: project, original image, PNG and JSON persist across service instances", async () => {
  const bytes = new Uint8Array(await readFile("examples/sample-floorplan.png")),
    source = await inspectImage(bytes, "floorplan.png");
  const p = await service().createProject("cloud roundtrip", source, true);
  const restored = await service().getProject(p.id);
  assert.equal(restored.name, p.name);
  assert.deepEqual(restored.plan, p.plan);
  assert.deepEqual((await service().sourceImage(p.id)).data, bytes);
  await service().savePng(p.id, bytes);
  assert.deepEqual(await service().getPng(p.id), bytes);
  const exported = await service().exportProject(p.id);
  assert.equal(exported.image!.width, 1400);
  const imported = await service().importProject(exported);
  assert.equal(imported.stage, "reconstruction");
  assert.ok(imported.plan.walls.every((w) => !w.reviewed));
});
test("real D1 CAS: simultaneous edits publish exactly one complete state", async () => {
  const p = await service().createProject("concurrent", undefined, true),
    roomId = p.plan.rooms[0].id;
  const results = await Promise.allSettled(
    ["first", "second"].map((name) =>
      service().mutateProject(
        p.id,
        0,
        [{ type: "update_room", roomId, name }],
        "agent",
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "REVISION_CONFLICT");
  const next = await service().getProject(p.id);
  assert.equal(next.revision, 1);
  assert.equal(next.history.length, 1);
});
test("cloud snapshots retain undo/redo and remain outside the D1 row", async () => {
  let p = await service().createProject("undo", undefined, true);
  const roomId = p.plan.rooms[0].id,
    oldName = p.plan.rooms[0].name;
  p = await service().mutateProject(
    p.id,
    p.revision,
    [{ type: "update_room", roomId, name: "new room" }],
    "user",
  );
  p = await service().mutateProject(
    p.id,
    p.revision,
    [{ type: "undo" }],
    "user",
  );
  assert.equal(p.plan.rooms.find((r) => r.id === roomId)!.name, oldName);
  p = await service().mutateProject(
    p.id,
    p.revision,
    [{ type: "redo" }],
    "user",
  );
  assert.equal(p.plan.rooms.find((r) => r.id === roomId)!.name, "new room");
  const row = await db
    .prepare("SELECT state_key FROM projects WHERE id=?")
    .bind(p.id)
    .first<{ state_key: string }>();
  const state = await (await files.get(row!.state_key))!.json<{
    historyKeys: string[];
    history?: unknown;
  }>();
  assert.equal(state.history, undefined);
  assert.ok(state.historyKeys.length > 0);
});
test("a failed atomic design batch leaves the D1 pointer and project untouched", async () => {
  const p = await service().createProject("rules", undefined, true);
  await assert.rejects(
    service().mutateProject(
      p.id,
      0,
      [
        {
          type: "update_room",
          roomId: p.plan.rooms[0].id,
          name: "should not save",
        },
        { type: "remove_wall", wallId: "ext_n" },
      ],
      "agent",
    ),
    (e) => e instanceof RuleError && e.code === "EXTERIOR_LOCKED",
  );
  assert.deepEqual(await service().getProject(p.id), p);
});
test("owner migration preserves ID, revision and history and never overwrites an existing project", async () => {
  const fixture = await service().createProject(
    "migration original",
    undefined,
    true,
  );
  const moved = structuredClone(fixture);
  moved.id = crypto.randomUUID();
  moved.revision = 7;
  moved.history = [
    { plan: structuredClone(moved.plan), stage: moved.stage, calibrated: true },
  ];
  await migrateProject(service(), { project: moved });
  assert.deepEqual(await service().getProject(moved.id), moved);
  await assert.rejects(
    migrateProject(service(), { project: { ...moved, name: "overwrite" } }),
    (e) => e instanceof RuleError && e.code === "ALREADY_EXISTS",
  );
  assert.equal((await service().getProject(moved.id)).name, moved.name);
});
test("R2 source uploads are immutable and an identical retry is safe", async () => {
  const p = await service().createProject("immutable source", undefined, true),
    id = p.id,
    repo = repository();
  await repo.putBinary(id, "source", new Uint8Array([1, 2, 3]), "image/png");
  await repo.putBinary(id, "source", new Uint8Array([1, 2, 3]), "image/png");
  await assert.rejects(
    repo.putBinary(id, "source", new Uint8Array([4, 5]), "image/png"),
    (e) => e instanceof RuleError && e.code === "ALREADY_EXISTS",
  );
  assert.deepEqual(
    await repo.getBinary(id, "source"),
    new Uint8Array([1, 2, 3]),
  );
});

test("real D1: registered users own their MCP credentials, sessions and projects", async () => {
  const { accounts } = await import("../src/server/accounts");
  const { userMcpTokens } = await import("../src/server/mcp-tokens");
  const { requireMcp, requireUser, issueSession } =
    await import("../src/server/auth");
  const outbox: import("../src/server/mail").AccountMail[] = [];
  const runtime = {
    mode: "cloudflare" as const,
    env: {
      DB: db,
      APP_ORIGIN: "https://floorplan.example.com",
      SESSION_SECRET: "test-session-secret-for-real-d1-users-more-than-32",
      MCP_TOKEN: "old-shared-token-more-than-32-characters",
    },
  };
  const users = await accounts(runtime, {
    async send(mail) {
      outbox.push(mail);
    },
  });
  const password = "test-account-password";
  for (const name of ["alice", "bob"]) {
    await users.register({
      username: name,
      email: `${name}@example.com`,
      password,
    });
    await users.verify(
      new URLSearchParams(new URL(outbox.at(-1)!.url).hash.slice(1)).get(
        "token",
      )!,
    );
  }
  const alice = (await users.repository.byUsername("alice"))!,
    bob = (await users.repository.byUsername("bob"))!;
  const aliceTokens = await userMcpTokens(runtime, alice.version),
    bobTokens = await userMcpTokens(runtime, bob.version);
  const a = await aliceTokens.issue(alice.id),
    b = await bobTokens.issue(bob.id);
  const request = (token: string) =>
    new Request("https://floorplan.example.com/api/mcp", {
      headers: { authorization: `Bearer ${token}` },
    });
  assert.equal((await requireMcp(request(a.token!), runtime)).userId, alice.id);
  assert.equal((await requireMcp(request(b.token!), runtime)).userId, bob.id);
  await assert.rejects(
    requireMcp(request(runtime.env.MCP_TOKEN), runtime),
    (e) => e instanceof RuleError && e.status === 401,
  );
  const aliceRepo = new CloudflareRepository(db, files, alice.id),
    bobRepo = new CloudflareRepository(db, files, bob.id);
  const aliceService = new ProjectService(aliceRepo),
    bobService = new ProjectService(bobRepo);
  const p = await aliceService.createProject("alice private", undefined, true);
  await aliceService.savePng(
    p.id,
    new Uint8Array(await readFile("examples/sample-floorplan.png")),
  );
  assert.equal((await bobService.listProjects()).length, 0);
  for (const action of [
    () => bobService.getProject(p.id),
    () => bobService.revision(p.id),
    () => bobService.getPng(p.id),
    () => bobService.exportProject(p.id),
    () => bobService.mutateProject(p.id, 0, [], "agent"),
  ])
    await assert.rejects(
      action,
      (e) => e instanceof RuleError && e.status === 404,
    );
  const forged = structuredClone(p);
  forged.name = "cross-user overwrite";
  await assert.rejects(
    bobRepo.save(forged, 0),
    (e) => e instanceof RuleError && e.status === 409,
  );
  assert.equal((await aliceService.getProject(p.id)).name, "alice private");
  const cookie = await issueSession(runtime, request(a.token!), alice);
  await users.forgot("alice@example.com");
  const reset = new URLSearchParams(
    new URL(outbox.at(-1)!.url).hash.slice(1),
  ).get("token")!;
  const resets = await Promise.allSettled([
    users.reset(reset, "alice-new-password"),
    users.reset(reset, "alice-other-password"),
  ]);
  assert.equal(resets.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(
    requireMcp(request(a.token!), runtime),
    (e) => e instanceof RuleError && e.status === 401,
  );
  await assert.rejects(
    requireUser(
      new Request(runtime.env.APP_ORIGIN, {
        headers: { cookie: `floorplan_session=${cookie.token}` },
      }),
      runtime,
    ),
    (e) => e instanceof RuleError && e.status === 401,
  );
  assert.equal((await requireMcp(request(b.token!), runtime)).userId, bob.id);
});

test("only the original owner can claim legacy D1/R2 data, including its old binary keys", async () => {
  const { accounts } = await import("../src/server/accounts"),
    { claimLegacyProjects } =
      await import("../src/server/repositories/legacy-projects");
  const runtime = {
    mode: "cloudflare" as const,
    env: {
      DB: db,
      APP_ORIGIN: "https://floorplan.example.com",
      APP_USERNAME: "original-owner",
      APP_PASSWORD: "original-owner-password",
      SESSION_SECRET: "owner-migration-session-key-more-than-32-characters",
    },
  };
  const accountService = await accounts(runtime),
    owner = (await accountService.bootstrap())!;
  const p = await service().createProject("legacy unclaimed", undefined, true);
  await db
    .prepare("UPDATE projects SET owner_id=NULL WHERE id=?")
    .bind(p.id)
    .run();
  await files.put(`files/${p.id}/source`, "legacy source");
  const outsider = (await accountService.repository.byUsername("bob"))!;
  await claimLegacyProjects(runtime, outsider);
  assert.equal(
    (await db
      .prepare("SELECT owner_id FROM projects WHERE id=?")
      .bind(p.id)
      .first<{ owner_id: string | null }>())!.owner_id,
    null,
  );
  await claimLegacyProjects(runtime, owner);
  const ownerRepo = new CloudflareRepository(db, files, owner.id),
    otherRepo = new CloudflareRepository(db, files, outsider.id);
  assert.equal((await ownerRepo.get(p.id)).name, p.name);
  assert.equal(
    new TextDecoder().decode(await ownerRepo.getBinary(p.id, "source")),
    "legacy source",
  );
  await assert.rejects(
    otherRepo.getBinary(p.id, "source"),
    (e) => e instanceof RuleError && e.status === 404,
  );
  const mine = await new ProjectService(otherRepo).createProject(
    "new user project",
    undefined,
    true,
  );
  await claimLegacyProjects(runtime, owner);
  assert.equal((await otherRepo.get(mine.id)).name, "new user project");
});
