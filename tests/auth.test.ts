import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  issueSession,
  requireUser,
  constantTimeEqual,
  validateOrigin,
  settings,
  sessionCookie,
} from "../src/server/auth";
import { configuredOrigin, type AppRuntime } from "../src/server/runtime";
import { RuleError } from "../src/domain/engine";
const runtime: AppRuntime = {
  mode: "cloudflare",
  env: {
    APP_ORIGIN: "https://floorplan.example.com",
    APP_USERNAME: "owner",
    APP_PASSWORD: "example-test-password",
    SESSION_SECRET: "example-test-session-key-with-more-than-32-chars",
    MCP_TOKEN: "example-test-mcp-token-with-more-than-32-chars",
  },
};
const request = (cookie?: string) =>
  new Request("https://floorplan.example.com/api/projects", {
    headers: cookie ? { cookie } : undefined,
  });
test("cloud mode fails closed without configured credentials and canonical origin", () => {
  assert.throws(
    () => settings({ mode: "cloudflare", env: {} }),
    (e) => e instanceof RuleError && e.status === 503,
  );
  assert.throws(
    () => configuredOrigin({ mode: "cloudflare", env: {} }),
    (e) => e instanceof RuleError && e.status === 503,
  );
});
test("only a valid, unexpired owner session authorizes browser APIs", async () => {
  await assert.rejects(
    requireUser(request(), runtime),
    (e) => e instanceof RuleError && e.status === 401,
  );
  const session = await issueSession(runtime, request());
  const user = await requireUser(
    request(`floorplan_session=${session.token}`),
    runtime,
  );
  assert.equal(user!.username, "owner");
  assert.equal(user!.csrf, session.csrf);
  const altered = session.token.slice(0, -5) + "aaaaa";
  await assert.rejects(
    requireUser(request(`floorplan_session=${altered}`), runtime),
  );
  const expired = await new SignJWT({
    username: "owner",
    csrf: "test",
    role: "user",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("https://floorplan.example.com")
    .setAudience("floorplan-web")
    .setExpirationTime(1)
    .sign(new TextEncoder().encode(runtime.env.SESSION_SECRET));
  await assert.rejects(
    requireUser(request(`floorplan_session=${expired}`), runtime),
  );
});
test("changing configured owner or session key invalidates old sessions", async () => {
  const session = await issueSession(runtime, request()),
    r = request(`floorplan_session=${session.token}`);
  await assert.rejects(
    requireUser(r, {
      ...runtime,
      env: { ...runtime.env, APP_USERNAME: "someone-else" },
    }),
  );
  await assert.rejects(
    requireUser(r, {
      ...runtime,
      env: {
        ...runtime.env,
        SESSION_SECRET: "another-test-session-key-more-than-32-characters",
      },
    }),
  );
});
test("MCP bearer credentials alone cannot authorize a browser API or user review", async () => {
  const r = new Request("https://floorplan.example.com/api/projects", {
    headers: {
      authorization: `Bearer ${runtime.env.MCP_TOKEN}`,
      origin: "https://floorplan.example.com",
    },
  });
  await assert.rejects(
    requireUser(r, runtime),
    (e) => e instanceof RuleError && e.status === 401,
  );
});
test("origin checks and secure session-cookie attributes are enforced", () => {
  assert.throws(() =>
    validateOrigin(
      new Request("https://floorplan.example.com/api/auth/login", {
        headers: { origin: "https://attacker.example" },
      }),
      runtime,
    ),
  );
  const cookie = sessionCookie("test", "https://floorplan.example.com");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(
    sessionCookie("", "https://floorplan.example.com", true),
    /Max-Age=0/,
  );
});
test("credential comparison handles unicode and unequal lengths without throwing", async () => {
  assert.equal(await constantTimeEqual("密码123", "密码123"), true);
  assert.equal(await constantTimeEqual("密码123", "密码1234"), false);
});
