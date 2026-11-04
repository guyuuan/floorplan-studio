import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { dataDirectory } from "./local";
import { RuleError } from "../../domain/engine";
import type { AccountRepository, User, UserAction } from "./accounts";

type State = { users: User[]; actions: UserAction[] };
export class LocalAccounts implements AccountRepository {
  constructor(private directory = path.join(dataDirectory, "accounts")) {}
  private async read(): Promise<State> {
    try {
      return JSON.parse(
        await readFile(path.join(this.directory, "accounts.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { users: [], actions: [] };
      throw e;
    }
  }
  private async change<T>(action: (state: State) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, "write.lock");
    let acquired = false;
    for (let n = 0; n < 100; n++) {
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
      throw new RuleError("BUSY", "账号正在更新，请稍后重试。", 503);
    const temp = path.join(this.directory, `${randomUUID()}.tmp`);
    try {
      const state = await this.read(),
        result = action(state);
      await writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      await rename(temp, path.join(this.directory, "accounts.json"));
      return result;
    } finally {
      await rm(temp, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
  async byId(id: string) {
    return (await this.read()).users.find((u) => u.id === id) ?? null;
  }
  async byUsername(username: string) {
    return (
      (await this.read()).users.find((u) => u.username === username) ?? null
    );
  }
  async byEmail(email: string) {
    return (await this.read()).users.find((u) => u.email === email) ?? null;
  }
  async legacyOwner() {
    return (await this.read()).users.find((u) => u.legacyOwner) ?? null;
  }
  async create(user: User) {
    return this.change((state) => {
      if (
        state.users.some(
          (u) =>
            u.id === user.id ||
            u.username === user.username ||
            (user.email && u.email === user.email) ||
            (user.legacyOwner && u.legacyOwner),
        )
      )
        return false;
      state.users.push(user);
      return true;
    });
  }
  async saveAction(action: UserAction) {
    await this.change((state) => {
      state.actions = state.actions.filter(
        (a) =>
          !(a.userId === action.userId && a.purpose === action.purpose) &&
          a.expiresAt > Date.now(),
      );
      state.actions.push(action);
    });
  }
  async action(hash: string) {
    return (await this.read()).actions.find((a) => a.hash === hash) ?? null;
  }
  async complete(
    hash: string,
    purpose: UserAction["purpose"],
    now: number,
    passwordHash?: string,
  ) {
    return this.change((state) => {
      const a = state.actions.find(
        (a) => a.hash === hash && a.purpose === purpose && a.expiresAt > now,
      );
      const user =
        a &&
        state.users.find((u) => u.id === a.userId && u.version === a.version);
      if (!a || !user) return null;
      if (purpose === "verify") {
        if (state.users.some((u) => u.id !== user.id && u.email === a.email))
          throw new RuleError("EMAIL_IN_USE", "邮箱已被其他账号使用。", 409);
        user.email = a.email;
        user.emailVerified = true;
      } else {
        if (!user.emailVerified || user.email !== a.email) return null;
        user.passwordHash = passwordHash!;
        user.version++;
      }
      state.actions = state.actions.filter(
        (v) =>
          v.userId !== user.id ||
          v.version !== a.version ||
          (purpose !== "reset" && v.hash !== hash),
      );
      return user;
    });
  }
}
