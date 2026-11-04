import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UserMcpTokens } from "../src/server/mcp-tokens";
import { LocalMcpTokenStore } from "../src/server/repositories/local-mcp-tokens";

async function fixture(
  fn: (service: UserMcpTokens, directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "floorplan-user-tokens-"),
  );
  try {
    await fn(
      new UserMcpTokens(
        new LocalMcpTokenStore(directory),
        "test-site-and-session-secret",
      ),
      directory,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("personal tokens are unique, bound to users and persisted only as hashes", async () =>
  fixture(async (service, directory) => {
    const alice = await service.issue("alice"),
      bob = await service.issue("bob");
    assert.match(alice.token!, /^fp_alice_[a-f0-9]{64}$/);
    assert.notEqual(alice.token, bob.token);
    assert.equal(await service.verify("alice", alice.token!), true);
    assert.equal(await service.verify("bob", alice.token!), false);
    assert.equal(await service.verify("alice", bob.token!), false);
    assert.equal(await service.verify("alice", `${alice.token!}x`), false);
    const restarted = new UserMcpTokens(
      new LocalMcpTokenStore(directory),
      "test-site-and-session-secret",
    );
    assert.equal(await restarted.verify("alice", alice.token!), true);
    const records = await readdir(directory);
    assert.equal(records.length, 2);
    for (const file of records) {
      const raw = await readFile(path.join(directory, file), "utf8");
      assert.ok(!raw.includes(alice.token!) && !raw.includes(bob.token!));
      assert.equal(
        (await stat(path.join(directory, file))).mode & 0o777,
        0o600,
      );
    }
  }));
test("creation races disclose exactly one token; repeat creation never rotates or reveals it", async () =>
  fixture(async (service, directory) => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.issue("alice")),
    );
    const issued = results.filter((r) => r.token);
    assert.equal(issued.length, 1);
    assert.equal(await service.verify("alice", issued[0].token!), true);
    assert.equal((await service.issue("alice")).token, null);
    assert.equal((await readdir(directory)).length, 1);
    assert.deepEqual(await service.status("unknown"), {
      exists: false,
      createdAt: null,
    });
  }));
test("rotation revokes the old credential without affecting another user, and scope changes revoke it", async () =>
  fixture(async (service, directory) => {
    const alice = await service.issue("alice"),
      bob = await service.issue("bob");
    const rotated = await service.issue("alice", true);
    assert.notEqual(alice.token, rotated.token);
    assert.equal(await service.verify("alice", alice.token!), false);
    assert.equal(await service.verify("alice", rotated.token!), true);
    assert.equal(await service.verify("bob", bob.token!), true);
    const changedSite = new UserMcpTokens(
      new LocalMcpTokenStore(directory),
      "new-origin-or-session-secret",
    );
    assert.equal(await changedSite.verify("alice", rotated.token!), false);
  }));
