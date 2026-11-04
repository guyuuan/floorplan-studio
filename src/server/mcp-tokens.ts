import { RuleError } from "../domain/engine";
import type { AppRuntime } from "./runtime";

export type McpTokenRecord = { hash: string; createdAt: string };
export interface McpTokenStore {
  get(username: string): Promise<McpTokenRecord | null>;
  /** Create only if absent, or atomically replace this user's credential. */
  save(
    username: string,
    record: McpTokenRecord,
    replace: boolean,
  ): Promise<boolean>;
}
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export class UserMcpTokens {
  constructor(
    private store: McpTokenStore,
    private scope: string,
  ) {}
  private async hash(username: string, token: string) {
    return hex(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([this.scope, username, token]),
          ),
        ),
      ),
    );
  }
  async status(username: string) {
    const record = await this.store.get(username);
    return { exists: !!record, createdAt: record?.createdAt ?? null };
  }
  async issue(username: string, replace = false) {
    const token = `fp_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
    const record = {
      hash: await this.hash(username, token),
      createdAt: new Date().toISOString(),
    };
    const saved = await this.store.save(username, record, replace);
    return { token: saved ? token : null, ...(await this.status(username)) };
  }
  async verify(username: string, token: string) {
    if (!/^fp_[a-f0-9]{64}$/.test(token)) return false;
    const record = await this.store.get(username);
    if (!record || !/^[a-f0-9]{64}$/.test(record.hash)) return false;
    const actual = await this.hash(username, token);
    let delta = 0;
    for (let i = 0; i < actual.length; i++)
      delta |= actual.charCodeAt(i) ^ record.hash.charCodeAt(i);
    return delta === 0;
  }
}
export async function userMcpTokens(runtime: AppRuntime) {
  let store: McpTokenStore;
  if (runtime.mode === "cloudflare") {
    const db = runtime.env.DB;
    if (!db)
      throw new RuleError("MISSING_BINDINGS", "缺少用户令牌存储 D1 DB。", 503);
    store = {
      async get(username) {
        return db
          .prepare(
            "SELECT token_hash AS hash, created_at AS createdAt FROM user_mcp_tokens WHERE username=?",
          )
          .bind(username)
          .first<McpTokenRecord>();
      },
      async save(username, record, replace) {
        const conflict = replace
          ? "DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at"
          : "DO NOTHING";
        const result = await db
          .prepare(
            `INSERT INTO user_mcp_tokens(username,token_hash,created_at) VALUES(?,?,?) ON CONFLICT(username) ${conflict}`,
          )
          .bind(username, record.hash, record.createdAt)
          .run();
        return result.meta.changes === 1;
      },
    };
  } else {
    const { LocalMcpTokenStore } =
      await import("./repositories/local-mcp-tokens");
    store = new LocalMcpTokenStore();
  }
  // Rotating the session secret or changing the site origin also invalidates existing tokens.
  return new UserMcpTokens(
    store,
    JSON.stringify([
      runtime.env.APP_ORIGIN ?? "local",
      runtime.env.SESSION_SECRET,
    ]),
  );
}
