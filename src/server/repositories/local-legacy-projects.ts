import {
  mkdir,
  readFile,
  readdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { dataDirectory } from "./local";
import { RuleError } from "../../domain/engine";
export async function importLegacyProjects(
  ownerId: string,
  root = dataDirectory,
) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(ownerId))
    throw new RuleError("INVALID_ID", "用户 ID 无效。", 400);
  const directory = path.join(root, "users", ownerId, "projects"),
    marker = path.join(directory, "legacy-imported"),
    lock = path.join(root, "legacy-import.lock");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let acquired = false;
  for (let i = 0; i < 100; i++) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  if (!acquired)
    throw new RuleError("BUSY", "旧项目正在迁移，请稍后重试。", 503);
  try {
    try {
      await readFile(marker);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const files = (await readdir(root)).filter((file) =>
      /^[a-zA-Z0-9_-]{1,100}\.(json|image|export\.png)$/.test(file),
    );
    // Copy rather than move the original data; a retry never overwrites a user's newer project.
    for (const file of files) {
      try {
        await copyFile(
          path.join(root, file),
          path.join(directory, file),
          constants.COPYFILE_EXCL,
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    await writeFile(marker, ownerId, { mode: 0o600 });
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
