import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import type { AppRuntime } from "../src/server/runtime";
import { RuleError } from "../src/domain/engine";
const directory = await mkdtemp(path.join(os.tmpdir(), "floorplan-session-"));
process.env.FLOORPLAN_DATA_DIR = directory;
const {
  issueSession,
  requireUser,
  constantTimeEqual,
  validateOrigin,
  settings,
  sessionCookie,
} = await import("../src/server/auth");
const { accounts } = await import("../src/server/accounts");
const { configuredOrigin } = await import("../src/server/runtime");
const runtime: AppRuntime = {
  mode: "local",
  env: {
    APP_ORIGIN: "https://floorplan.example.com",
    APP_USERNAME: "owner",
    APP_PASSWORD: "example-test-password",
    SESSION_SECRET: "example-test-session-key-with-more-than-32-chars",
  },
};
const service = await accounts(runtime),
  user = (await service.bootstrap())!;
after(() => rm(directory, { recursive: true, force: true }));
const request = (cookie?: string) =>
  new Request("https://floorplan.example.com/api/projects", {
    headers: cookie ? { cookie } : undefined,
  });
test("cloud mode fails closed without a session key or canonical origin", () => {
  assert.throws(
    () => settings({ mode: "cloudflare", env: {} }),
    (e) => e instanceof RuleError && e.status === 503,
  );
  assert.throws(
    () => configuredOrigin({ mode: "cloudflare", env: {} }),
    (e) => e instanceof RuleError && e.status === 503,
  );
});
test("only valid unexpired sessions bound to an existing immutable user ID authorize browser APIs", async () => {
  await assert.rejects(
    requireUser(request(), runtime),
    (e) => e instanceof RuleError && e.status === 401,
  );
  const session = await issueSession(runtime, request(), user),
    identity = await requireUser(
      request(`floorplan_session=${session.token}`),
      runtime,
    );
  assert.equal(identity!.userId, user.id);
  assert.equal(identity!.username, "owner");
  assert.equal(identity!.csrf, session.csrf);
  await assert.rejects(
    requireUser(
      request(`floorplan_session=${session.token.slice(0, -5)}aaaaa`),
      runtime,
    ),
  );
  const expired = await new SignJWT({
    username: user.username,
    version: user.version,
    csrf: "test",
    role: "user",
  })
    .setSubject(user.id)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(runtime.env.APP_ORIGIN!)
    .setAudience("floorplan-web")
    .setExpirationTime(1)
    .sign(new TextEncoder().encode(runtime.env.SESSION_SECRET));
  await assert.rejects(
    requireUser(request(`floorplan_session=${expired}`), runtime),
  );
});
test("session key rotation revokes sessions; editing bootstrap environment never changes identity", async () => {
  const session = await issueSession(runtime, request(), user),
    r = request(`floorplan_session=${session.token}`);
  assert.equal(
    (await requireUser(r, {
      ...runtime,
      env: { ...runtime.env, APP_USERNAME: "other" },
    }))!.userId,
    user.id,
  );
  await assert.rejects(
    requireUser(r, {
      ...runtime,
      env: {
        ...runtime.env,
        SESSION_SECRET: "another-session-key-more-than-32-characters",
      },
    }),
  );
});
test("MCP bearer credentials cannot authorize user APIs", async () => {
  await assert.rejects(
    requireUser(
      new Request("https://floorplan.example.com/api/projects", {
        headers: {
          authorization: "Bearer personal-token",
          origin: "https://floorplan.example.com",
        },
      }),
      runtime,
    ),
    (e) => e instanceof RuleError && e.status === 401,
  );
});
test("origin checks and secure session cookie attributes are enforced", () => {
  assert.throws(() =>
    validateOrigin(
      new Request("https://floorplan.example.com/api/auth/login", {
        headers: { origin: "https://attacker.example" },
      }),
      runtime,
    ),
  );
  const cookie = sessionCookie("test", "https://floorplan.example.com");
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict"])
    assert.ok(cookie.includes(attribute));
  assert.match(
    sessionCookie("", "https://floorplan.example.com", true),
    /Max-Age=0/,
  );
});
test("credential comparison handles unicode and unequal lengths", async () => {
  assert.equal(await constantTimeEqual("密码123", "密码123"), true);
  assert.equal(await constantTimeEqual("密码123", "密码1234"), false);
});
