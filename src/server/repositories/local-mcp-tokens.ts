import { mkdir, readFile, writeFile, rename, link, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { dataDirectory } from "./local";
import type { McpTokenRecord, McpTokenStore } from "../mcp-tokens";

export class LocalMcpTokenStore implements McpTokenStore {
  constructor(private directory = path.join(dataDirectory, "mcp-users")) {}
  private file(username: string) {
    return path.join(
      this.directory,
      `${createHash("sha256").update(username).digest("hex")}.json`,
    );
  }
  async get(username: string): Promise<McpTokenRecord | null> {
    try {
      return JSON.parse(await readFile(this.file(username), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async save(username: string, record: McpTokenRecord, replace: boolean) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(username),
      temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(record), {
        mode: 0o600,
        flag: "wx",
      });
      if (replace) await rename(temp, file);
      else await link(temp, file);
      return true;
    } catch (e) {
      if (!replace && (e as NodeJS.ErrnoException).code === "EEXIST")
        return false;
      throw e;
    } finally {
      await rm(temp, { force: true });
    }
  }
}
