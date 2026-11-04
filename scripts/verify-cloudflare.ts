import assert from "node:assert/strict";
import { parse } from "jsonc-parser";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Public synthetic credentials, used only on loopback with an isolated disposable local database.
const origin = "http://127.0.0.1:8788",
  testEnv = {
    APP_ORIGIN: origin,
    APP_USERNAME: "preview-owner",
    APP_PASSWORD: "example-password-for-local-tests",
    SESSION_SECRET: "example-session-secret-for-local-tests-only",
    MCP_TOKEN: "example-mcp-token-for-local-tests-only",
  };
const root = process.cwd(),
  directory = path.join(root, "work/cloudflare-smoke"),
  configPath = path.join(directory, "wrangler.json"),
  state = path.join(directory, "state");
await mkdir(directory, { recursive: true });
await rm(state, { recursive: true, force: true });
const config = parse(await readFile("wrangler.jsonc", "utf8"));
Object.assign(config, {
  name: "floorplan-studio-smoke",
  main: path.join(root, ".open-next/worker.js"),
  assets: { ...config.assets, directory: path.join(root, ".open-next/assets") },
  services: [
    { binding: "WORKER_SELF_REFERENCE", service: "floorplan-studio-smoke" },
  ],
  vars: { FLOORPLAN_STORAGE: "cloudflare", ...testEnv },
});
config.d1_databases = [
  {
    binding: "DB",
    database_name: "floorplan-smoke",
    database_id: "isolated-smoke-database",
    migrations_dir: path.join(root, "migrations"),
  },
];
config.r2_buckets = [{ binding: "FILES", bucket_name: "isolated-smoke-files" }];
await writeFile(configPath, JSON.stringify(config));
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
let server: ChildProcess | undefined,
  logs = "";
const run = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath, [wrangler, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    p.stdout.on("data", (s) => (logs = (logs + s).slice(-12000)));
    p.stderr.on("data", (s) => (logs = (logs + s).slice(-12000)));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Wrangler failed: ${code}`)),
    );
  });
const clients: Client[] = [];
try {
  await run([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    state,
  ]);
  server = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      "8788",
      "--config",
      configPath,
      "--persist-to",
      state,
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  server.stdout!.on("data", (s) => (logs = (logs + s).slice(-12000)));
  server.stderr!.on("data", (s) => (logs = (logs + s).slice(-12000)));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${origin}/api/auth/session`);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.ok(ready, "Worker did not start");
  const anon = await fetch(`${origin}/api/projects`);
  assert.equal(anon.status, 401);
  const home = await fetch(origin, { redirect: "manual" });
  assert.equal(home.status, 307);
  assert.equal(
    new URL(home.headers.get("location")!, origin).pathname,
    "/login",
  );
  let r = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ username: "preview-owner", password: "wrong" }),
  });
  assert.equal(r.status, 401);
  r = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      username: testEnv.APP_USERNAME,
      password: testEnv.APP_PASSWORD,
    }),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!.split(";")[0],
    { csrf } = await r.json();
  const headers = { origin, cookie, "x-floorplan-csrf": csrf };
  r = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { origin, cookie },
    body: new FormData(),
  });
  assert.equal(r.status, 403);
  const form = new FormData();
  form.set("name", "Workers smoke fixture");
  form.set("demo", "true");
  r = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers,
    body: form,
  });
  assert.equal(r.status, 201, await r.clone().text());
  const project = await r.json();
  r = await fetch(`${origin}/api/projects/${project.id}`, {
    headers: { cookie, "if-none-match": '"revision:0"' },
  });
  assert.equal(r.status, 304);
  // Personal credential issuance requires the same user session + CSRF protections as edits.
  r = await fetch(`${origin}/api/setup`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ action: "create" }),
  });
  assert.equal(r.status, 401);
  r = await fetch(`${origin}/api/setup`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "create" }),
  });
  assert.equal(r.status, 403);
  const issue = async (action: "create" | "rotate") => {
    const response = await fetch(`${origin}/api/setup`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const generated = await issue("create");
  assert.equal(generated.credential.username, testEnv.APP_USERNAME);
  assert.equal(generated.credential.issued, true);
  const personalToken =
    generated.mcpServers["floorplan-studio"].headers.Authorization.slice(7);
  assert.match(personalToken, /^fp_[a-f0-9]{64}$/);
  const reread = await (
    await fetch(`${origin}/api/setup`, { headers: { cookie } })
  ).json();
  assert.equal(reread.credential.exists, true);
  assert.ok(!JSON.stringify(reread).includes(personalToken));
  const duplicate = await issue("create");
  assert.equal(duplicate.credential.issued, false);
  assert.ok(!JSON.stringify(duplicate).includes(personalToken));
  r = await fetch(`${origin}/api/agent/projects`, {
    headers: { authorization: `Bearer ${testEnv.MCP_TOKEN}` },
  });
  assert.equal(r.status, 401);
  const client = new Client({ name: "worker-smoke", version: "1" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${personalToken}` },
      },
    }),
  );
  assert.equal((await client.listTools()).tools.length, 8);
  const denied = await client.callTool({
    name: "apply_design_commands",
    arguments: {
      projectId: project.id,
      expectedRevision: 0,
      commands: [{ type: "classify_wall", wallId: "ext_n", kind: "partition" }],
    },
  });
  assert.equal(denied.isError, true);
  const result = await client.callTool({
    name: "apply_design_commands",
    arguments: {
      projectId: project.id,
      expectedRevision: 0,
      commands: [
        {
          type: "update_room",
          roomId: project.plan.rooms[0].id,
          name: "cloud room",
        },
      ],
    },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  r = await fetch(`${origin}/api/projects/${project.id}/commands`, {
    method: "POST",
    headers: {
      origin,
      authorization: `Bearer ${personalToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      expectedRevision: 1,
      commands: [{ type: "review_walls" }],
    }),
  });
  assert.equal(r.status, 401);
  r = await fetch(`${origin}/api/projects/${project.id}/commands`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: 0,
      commands: [
        {
          type: "update_room",
          roomId: project.plan.rooms[0].id,
          name: "stale",
        },
      ],
    }),
  });
  assert.equal(r.status, 409);
  r = await fetch(`${origin}/api/projects/${project.id}`, {
    headers: { cookie },
  });
  const current = await r.json();
  const migrated = {
    ...current,
    id: crypto.randomUUID(),
    name: "Migrated smoke fixture",
    revision: 7,
  };
  r = await fetch(`${origin}/api/migrate`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ project: migrated }),
  });
  assert.equal(r.status, 201, await r.clone().text());
  r = await fetch(`${origin}/api/projects/${migrated.id}`, {
    headers: { cookie },
  });
  const migratedRead = await r.json();
  assert.equal(migratedRead.revision, 7);
  assert.equal(migratedRead.history.length, current.history.length);
  r = await fetch(`${origin}/api/migrate`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ project: migrated }),
  });
  assert.equal(r.status, 409);
  const bytes = await readFile("examples/sample-floorplan.png");
  r = await fetch(`${origin}/api/projects/${project.id}/png`, {
    method: "POST",
    headers: { ...headers, "content-type": "image/png" },
    body: bytes,
  });
  assert.equal(r.status, 200);
  r = await fetch(`${origin}/api/projects/${project.id}/png`, {
    headers: { cookie },
  });
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
  r = await fetch(`${origin}/api/projects/${project.id}/export`, {
    headers: { cookie },
  });
  assert.equal((await r.json()).schemaVersion, 1);
  const imageForm = new FormData();
  imageForm.set("name", "Workers image fixture");
  imageForm.set(
    "image",
    new File([bytes], "sample.png", { type: "image/png" }),
  );
  r = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers,
    body: imageForm,
  });
  assert.equal(r.status, 201);
  const imageProject = await r.json();
  const source = await client.callTool({
    name: "get_source_image",
    arguments: { projectId: imageProject.id },
  });
  assert.ok(
    (source.content as { type: string }[]).some((c) => c.type === "image"),
  );
  const rotatedConfig = await issue("rotate");
  const rotatedToken =
    rotatedConfig.mcpServers["floorplan-studio"].headers.Authorization.slice(7);
  assert.notEqual(rotatedToken, personalToken);
  r = await fetch(`${origin}/api/agent/projects`, {
    headers: { authorization: `Bearer ${personalToken}` },
  });
  assert.equal(r.status, 401);
  const freshClient = new Client({
    name: "rotated-credential-smoke",
    version: "1",
  });
  clients.push(freshClient);
  await freshClient.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${rotatedToken}` } },
    }),
  );
  assert.equal((await freshClient.listTools()).tools.length, 8);
  r = await fetch(`${origin}/api/auth/logout`, { method: "POST", headers });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie")!, /Max-Age=0/);
  console.log(
    "Workers smoke passed: login, CSRF, per-user token issuance and revocation, private APIs, D1/R2, conditional polling, remote MCP, human-only review, revision conflicts, PNG, original image and JSON export.",
  );
} catch (e) {
  console.error(logs);
  throw e;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  if (server)
    await new Promise<void>((resolve) => {
      if (server!.exitCode !== null) return resolve();
      server!.once("exit", () => resolve());
      setTimeout(resolve, 5000).unref();
    });
}
