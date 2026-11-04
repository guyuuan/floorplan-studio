import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LocalRepository } from "../src/server/repositories/local";
import { importLegacyProjects } from "../src/server/repositories/local-legacy-projects";
import { ProjectService } from "../src/server/store";
import { RuleError } from "../src/domain/engine";
test("local account namespaces isolate identical project IDs and binary files; legacy import preserves source and never overwrites edits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "floorplan-owner-"));
  try {
    const legacy = new ProjectService(new LocalRepository(root)),
      p = await legacy.createProject("old project", undefined, true);
    await writeFile(path.join(root, `${p.id}.image`), "legacy source");
    await importLegacyProjects("owner", root);
    const owner = new ProjectService(
        new LocalRepository(path.join(root, "users/owner/projects")),
      ),
      bob = new ProjectService(
        new LocalRepository(path.join(root, "users/bob/projects")),
      );
    assert.equal((await owner.getProject(p.id)).name, "old project");
    assert.deepEqual(await bob.listProjects(), []);
    await assert.rejects(
      bob.getProject(p.id),
      (e) => e instanceof RuleError && e.status === 404,
    );
    assert.equal(
      (await owner.repository.getBinary(p.id, "source")).toString(),
      new TextEncoder().encode("legacy source").toString(),
    );
    await owner.mutateProject(
      p.id,
      0,
      [{ type: "update_room", roomId: p.plan.rooms[0].id, name: "my edit" }],
      "user",
    );
    await importLegacyProjects("owner", root);
    assert.equal((await owner.getProject(p.id)).revision, 1);
    assert.equal(
      JSON.parse(await readFile(path.join(root, `${p.id}.json`), "utf8"))
        .revision,
      0,
    );
    const b = { ...structuredClone(p), name: "bob project" };
    await bob.repository.save(b, null);
    await bob.repository.putBinary(
      p.id,
      "source",
      new TextEncoder().encode("bob source"),
      "image/png",
    );
    assert.equal(
      (await owner.repository.getBinary(p.id, "source")).toString(),
      new TextEncoder().encode("legacy source").toString(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
