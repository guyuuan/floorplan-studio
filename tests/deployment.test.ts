import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deploymentSettings,
  writeDeploymentConfig,
} from "../scripts/cloudflare-config.mjs";
const env = {
  APP_ORIGIN: "https://floorplan.example.com",
  APP_USERNAME: "example-owner",
  APP_PASSWORD: "example-owner-password",
  SESSION_SECRET: "example-session-secret-more-than-32-characters",
  MCP_TOKEN: "example-mcp-token-more-than-32-characters",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  FLOORPLAN_D1_ID: "11111111-1111-1111-1111-111111111111",
};
test("deployment requires real configuration and rejects loopback, paths and shared secrets", () => {
  assert.throws(() => deploymentSettings({}));
  assert.throws(() =>
    deploymentSettings({ ...env, APP_ORIGIN: "http://127.0.0.1:8787" }),
  );
  assert.throws(() =>
    deploymentSettings({
      ...env,
      APP_ORIGIN: "https://floorplan.example.com/subpath",
    }),
  );
  assert.throws(() =>
    deploymentSettings({ ...env, MCP_TOKEN: env.SESSION_SECRET }),
  );
});
test("deployment configuration uses environment-provided domain and bindings without exposing secrets", async () => {
  const file = await writeDeploymentConfig(env),
    text = await readFile(file, "utf8"),
    config = JSON.parse(text);
  assert.equal(config.routes[0].pattern, "floorplan.example.com");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.d1_databases[0].database_id, env.FLOORPLAN_D1_ID);
  for (const secret of [env.APP_PASSWORD, env.SESSION_SECRET, env.MCP_TOKEN])
    assert.ok(!text.includes(secret));
});
