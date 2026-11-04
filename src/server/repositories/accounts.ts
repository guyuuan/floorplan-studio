import type { AppRuntime } from "../runtime";
import { RuleError } from "../../domain/engine";

export type User = {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  passwordHash: string;
  version: number;
  legacyOwner: boolean;
  createdAt: string;
};
export type UserAction = {
  hash: string;
  userId: string;
  purpose: "verify" | "reset";
  email: string;
  expiresAt: number;
  version: number;
};
export interface AccountRepository {
  byId(id: string): Promise<User | null>;
  byUsername(username: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  legacyOwner(): Promise<User | null>;
  create(user: User): Promise<boolean>;
  saveAction(action: UserAction): Promise<void>;
  action(hash: string): Promise<UserAction | null>;
  complete(
    hash: string,
    purpose: UserAction["purpose"],
    now: number,
    passwordHash?: string,
  ): Promise<User | null>;
}
const columns =
  "id,username,email,email_verified AS emailVerified,password_hash AS passwordHash,session_version AS version,legacy_owner AS legacyOwner,created_at AS createdAt";
function decode(row: User | null): User | null {
  return row
    ? {
        ...row,
        emailVerified: !!row.emailVerified,
        legacyOwner: !!row.legacyOwner,
      }
    : null;
}
export async function accountRepository(
  runtime: AppRuntime,
): Promise<AccountRepository> {
  if (runtime.mode === "local") {
    const { LocalAccounts } = await import("./local-accounts");
    return new LocalAccounts();
  }
  const db = runtime.env.DB;
  if (!db) throw new RuleError("MISSING_BINDINGS", "缺少账号存储 D1 DB。", 503);
  const find = async (
    column: "id" | "username" | "email" | "legacy_owner",
    value: string | number,
  ) =>
    decode(
      await db
        .prepare(`SELECT ${columns} FROM users WHERE ${column}=?`)
        .bind(value)
        .first<User>(),
    );
  const repository: AccountRepository = {
    byId: (id) => find("id", id),
    byUsername: (username) => find("username", username),
    byEmail: (email) => find("email", email),
    legacyOwner: () => find("legacy_owner", 1),
    async create(user) {
      const result = await db
        .prepare(
          "INSERT INTO users(id,username,email,email_verified,password_hash,session_version,legacy_owner,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
        )
        .bind(
          user.id,
          user.username,
          user.email,
          user.emailVerified ? 1 : 0,
          user.passwordHash,
          user.version,
          user.legacyOwner ? 1 : 0,
          user.createdAt,
        )
        .run();
      return result.meta.changes === 1;
    },
    async saveAction(a) {
      await db
        .prepare(
          "INSERT INTO user_actions(token_hash,user_id,purpose,email,expires_at,session_version) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,purpose) DO UPDATE SET token_hash=excluded.token_hash,email=excluded.email,expires_at=excluded.expires_at,session_version=excluded.session_version",
        )
        .bind(a.hash, a.userId, a.purpose, a.email, a.expiresAt, a.version)
        .run();
    },
    async action(hash) {
      return db
        .prepare(
          "SELECT token_hash AS hash,user_id AS userId,purpose,email,expires_at AS expiresAt,session_version AS version FROM user_actions WHERE token_hash=?",
        )
        .bind(hash)
        .first<UserAction>();
    },
    async complete(hash, purpose, now, passwordHash) {
      const action = await this.action(hash);
      if (!action || action.purpose !== purpose || action.expiresAt <= now)
        return null;
      const predicate =
        "id=? AND session_version=? AND EXISTS(SELECT 1 FROM user_actions WHERE token_hash=? AND purpose=? AND expires_at>? AND user_id=users.id AND session_version=users.session_version)";
      const update =
        purpose === "verify"
          ? db
              .prepare(
                `UPDATE users SET email=?,email_verified=1 WHERE ${predicate}`,
              )
              .bind(
                action.email,
                action.userId,
                action.version,
                hash,
                purpose,
                now,
              )
          : db
              .prepare(
                `UPDATE users SET password_hash=?,session_version=session_version+1 WHERE email_verified=1 AND email=? AND ${predicate}`,
              )
              .bind(
                passwordHash!,
                action.email,
                action.userId,
                action.version,
                hash,
                purpose,
                now,
              );
      let results;
      try {
        results = await db.batch([
          update,
          db
            .prepare(
              "DELETE FROM user_actions WHERE user_id=? AND session_version=? AND (?='reset' OR token_hash=?)",
            )
            .bind(action.userId, action.version, purpose, hash),
        ]);
      } catch (e) {
        if (String(e).includes("UNIQUE constraint"))
          throw new RuleError("EMAIL_IN_USE", "邮箱已被其他账号使用。", 409);
        throw e;
      }
      return results[0].meta.changes === 1 ? this.byId(action.userId) : null;
    },
  };
  return repository;
}
