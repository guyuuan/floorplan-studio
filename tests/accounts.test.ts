import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Accounts, actionHash } from "../src/server/accounts";
import { LocalAccounts } from "../src/server/repositories/local-accounts";
import type { AccountMail } from "../src/server/mail";
import type { AppRuntime } from "../src/server/runtime";
import { RuleError } from "../src/domain/engine";
const password = "example-account-password";
const runtime: AppRuntime = {
  mode: "local",
  env: {
    APP_ORIGIN: "https://floorplan.example.com",
    SESSION_SECRET: "test-session-secret-for-account-tests-more-than-32",
  },
};
const token = (mail: AccountMail) =>
  new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token")!;
const fails = (code: string) => (e: unknown) =>
  e instanceof RuleError && e.code === code;
async function fixture(
  run: (ctx: {
    service: Accounts;
    repo: LocalAccounts;
    outbox: AccountMail[];
    directory: string;
  }) => Promise<void>,
  env = runtime.env,
) {
  const directory = await mkdtemp(
      path.join(os.tmpdir(), "floorplan-accounts-"),
    ),
    repo = new LocalAccounts(directory),
    outbox: AccountMail[] = [];
  try {
    await run({
      service: new Accounts(
        repo,
        { ...runtime, env },
        {
          async send(mail) {
            outbox.push(mail);
          },
        },
      ),
      repo,
      outbox,
      directory,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("registration normalizes identity, hashes passwords and requires one-time email verification", async () =>
  fixture(async ({ service, repo, outbox, directory }) => {
    await service.register({
      username: "Alice",
      email: "Alice@Example.com",
      password,
    });
    const user = (await repo.byUsername("alice"))!;
    assert.equal(user.email, "alice@example.com");
    assert.equal(user.emailVerified, false);
    assert.ok(!user.passwordHash.includes(password));
    assert.ok(
      !(await readFile(path.join(directory, "accounts.json"), "utf8")).includes(
        token(outbox[0]),
      ),
    );
    await assert.rejects(
      service.authenticate("alice", password),
      fails("EMAIL_NOT_VERIFIED"),
    );
    const results = await Promise.allSettled([
      service.verify(token(outbox[0])),
      service.verify(token(outbox[0])),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await service.authenticate("ALICE@example.com", password)).id,
      user.id,
    );
    assert.equal((await service.authenticate("Alice", password)).id, user.id);
    await assert.rejects(
      service.authenticate("alice", "wrong"),
      fails("INVALID_CREDENTIALS"),
    );
  }));
test("unique accounts are atomic across simultaneous registration, including canonical email", async () =>
  fixture(async ({ service, repo }) => {
    const results = await Promise.allSettled([
      service.register({
        username: "alice",
        email: "same@example.com",
        password,
      }),
      service.register({
        username: "bob",
        email: "SAME@example.com",
        password,
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(await repo.byEmail("same@example.com"));
    await assert.rejects(
      service.register({ username: "a/b", email: "a@example.com", password }),
    );
    await assert.rejects(
      service.register({
        username: "good",
        email: "a@example.com",
        password: "short",
      }),
    );
  }));
test("resend invalidates the previous verification link; expired links never activate accounts", async () =>
  fixture(async ({ service, repo, outbox }) => {
    await service.register({
      username: "alice",
      email: "alice@example.com",
      password,
    });
    const first = token(outbox[0]);
    await service.resend("alice@example.com");
    await assert.rejects(service.verify(first), fails("INVALID_ACTION_TOKEN"));
    const current = token(outbox[1]),
      record = (await repo.action(await actionHash(current)))!;
    await repo.saveAction({ ...record, expiresAt: Date.now() - 1 });
    await assert.rejects(
      service.verify(current),
      fails("INVALID_ACTION_TOKEN"),
    );
    assert.equal((await repo.byUsername("alice"))!.emailVerified, false);
  }));
test("password recovery revokes old credentials and consumes only one concurrent reset", async () =>
  fixture(async ({ service, repo, outbox }) => {
    await service.register({
      username: "alice",
      email: "alice@example.com",
      password,
    });
    await service.verify(token(outbox[0]));
    await service.forgot("missing@example.com");
    assert.equal(outbox.length, 1);
    await service.forgot("alice@example.com");
    const reset = token(outbox[1]);
    const results = await Promise.allSettled([
      service.reset(reset, "new-example-password"),
      service.reset(reset, "second-new-password"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await repo.byUsername("alice"))!.version, 1);
    await assert.rejects(
      service.authenticate("alice", password),
      fails("INVALID_CREDENTIALS"),
    );
    await assert.rejects(
      service.reset(reset, "another-new-password"),
      fails("INVALID_ACTION_TOKEN"),
    );
    const valid = await Promise.allSettled([
      service.authenticate("alice", "new-example-password"),
      service.authenticate("alice", "second-new-password"),
    ]);
    assert.equal(valid.filter((r) => r.status === "fulfilled").length, 1);
  }));
test("existing owner is reserved, survives env password changes, and can bind a verified recovery email", async () =>
  fixture(
    async ({ service, repo, outbox }) => {
      await assert.rejects(
        service.register({
          username: "owner",
          email: "someone@example.com",
          password,
        }),
        fails("ACCOUNT_EXISTS"),
      );
      const owner = await service.bootstrap();
      assert.ok(owner!.legacyOwner);
      assert.equal(owner!.email, null);
      assert.equal(
        (await service.authenticate("owner", password)).id,
        owner!.id,
      );
      await assert.rejects(
        service.bindEmail(owner!.id, "owner@example.com", "wrong"),
        fails("INVALID_CREDENTIALS"),
      );
      await service.bindEmail(owner!.id, "owner@example.com", password);
      assert.equal((await repo.byId(owner!.id))!.email, null);
      await service.verify(token(outbox[0]));
      assert.equal((await repo.byId(owner!.id))!.email, "owner@example.com");
      const changed = new Accounts(repo, {
        ...runtime,
        env: {
          ...runtime.env,
          APP_USERNAME: "new-owner",
          APP_PASSWORD: "different-env-password",
        },
      });
      assert.equal((await changed.bootstrap())!.id, owner!.id);
      assert.equal(
        (await changed.authenticate("owner", password)).id,
        owner!.id,
      );
    },
    { ...runtime.env, APP_USERNAME: "owner", APP_PASSWORD: password },
  ));
test("closed registration cannot create accounts", async () =>
  fixture(
    async ({ service, repo }) => {
      await assert.rejects(
        service.register({
          username: "alice",
          email: "alice@example.com",
          password,
        }),
        fails("REGISTRATION_DISABLED"),
      );
      assert.equal(await repo.byUsername("alice"), null);
    },
    { ...runtime.env, REGISTRATION_ENABLED: "false" },
  ));
test("failed email delivery leaves a recoverable pending account; resend completes verification", async () =>
  fixture(async ({ service, repo, outbox }) => {
    const failing = new Accounts(repo, runtime, {
      async send() {
        throw new RuleError("EMAIL_DELIVERY_FAILED", "unavailable", 503);
      },
    });
    await assert.rejects(
      failing.register({
        username: "alice",
        email: "alice@example.com",
        password,
      }),
      fails("EMAIL_DELIVERY_FAILED"),
    );
    assert.equal((await repo.byUsername("alice"))!.emailVerified, false);
    await service.resend("alice@example.com");
    await service.verify(token(outbox[0]));
    assert.equal((await repo.byUsername("alice"))!.emailVerified, true);
  }));

test("an original email-shaped username remains usable and cannot be claimed as a registration email", async () =>
  fixture(
    async ({ service }) => {
      await assert.rejects(
        service.register({
          username: "attacker",
          email: "owner@example.com",
          password,
        }),
        fails("ACCOUNT_EXISTS"),
      );
      const owner = await service.bootstrap();
      assert.equal(
        (await service.authenticate("OWNER@example.com", password)).id,
        owner!.id,
      );
    },
    {
      ...runtime.env,
      APP_USERNAME: "owner@example.com",
      APP_PASSWORD: password,
    },
  ));

test("registration and reset enforce 8–24 characters, and both username and email can log in", async () =>
  fixture(async ({ service, repo, outbox }) => {
    await assert.rejects(
      service.register({
        username: "short",
        email: "short@example.com",
        password: "1234567",
      }),
    );
    await assert.rejects(
      service.register({
        username: "long",
        email: "long@example.com",
        password: "x".repeat(25),
      }),
    );
    assert.equal(await repo.byUsername("short"), null);
    assert.equal(await repo.byUsername("long"), null);
    const eight = "eight888",
      twentyFour = "x".repeat(24);
    await service.register({
      username: "alice",
      email: "alice@example.com",
      password: eight,
    });
    await service.verify(token(outbox[0]));
    const user = await service.authenticate("alice", eight);
    assert.equal(
      (await service.authenticate("alice@example.com", eight)).id,
      user.id,
    );
    await service.forgot("alice@example.com");
    const reset = token(outbox[1]);
    await assert.rejects(
      service.reset(reset, "x".repeat(25)),
      fails("INVALID_PASSWORD"),
    );
    await assert.rejects(
      service.reset(reset, "1234567"),
      fails("INVALID_PASSWORD"),
    );
    await service.reset(reset, twentyFour);
    assert.equal(
      (await service.authenticate("alice@example.com", twentyFour)).id,
      user.id,
    );
  }));
