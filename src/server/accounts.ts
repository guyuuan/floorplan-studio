import { z } from "zod";
import { RuleError } from "../domain/engine";
import { hashPassword, verifyPassword, validatePassword } from "./passwords";
import {
  accountRepository,
  type AccountRepository,
  type User,
  type UserAction,
} from "./repositories/accounts";
import { accountMailer, type Mailer } from "./mail";
import type { AppRuntime } from "./runtime";

export const normalizedName = (name: string) =>
  name.normalize("NFKC").trim().toLowerCase();
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("请输入有效的邮箱地址。");
export const registrationSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9_.-]{2,39}$/,
      "用户名需为 3–40 位字母、数字、下划线、点或短横线。",
    ),
  email: emailSchema,
  password: z.string().min(8, "密码至少 8 位。").max(24, "密码最多 24 位。"),
});
export function registrationEnabled(runtime: AppRuntime) {
  const value = runtime.env.REGISTRATION_ENABLED;
  if (value !== undefined && value !== "true" && value !== "false")
    throw new RuleError(
      "INVALID_CONFIGURATION",
      "REGISTRATION_ENABLED 只能为 true 或 false。",
      503,
    );
  return value !== "false";
}
const invalidAction = () =>
  new RuleError("INVALID_ACTION_TOKEN", "链接无效或已过期，请重新申请。", 400);
export async function actionHash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export class Accounts {
  constructor(
    public repository: AccountRepository,
    private runtime: AppRuntime,
    private mailer?: Mailer,
  ) {}
  private mail() {
    return this.mailer ?? accountMailer(this.runtime);
  }
  private newUser(
    username: string,
    email: string | null,
    passwordHash: string,
    legacyOwner = false,
  ): User {
    return {
      id: crypto.randomUUID(),
      username,
      email,
      passwordHash,
      emailVerified: legacyOwner,
      legacyOwner,
      version: 0,
      createdAt: new Date().toISOString(),
    };
  }
  async bootstrap() {
    const existing = await this.repository.legacyOwner();
    if (existing) return existing;
    const {
      APP_USERNAME: username,
      APP_PASSWORD: password,
      APP_OWNER_EMAIL: email,
    } = this.runtime.env;
    if (!username && !password) return null;
    if (!username || !password || password.length < 8 || password.length > 256)
      throw new RuleError(
        "INVALID_CONFIGURATION",
        "原账号迁移需要同时配置 APP_USERNAME 和 8–256 位 APP_PASSWORD。",
        503,
      );
    const user = this.newUser(
      normalizedName(username),
      email ? emailSchema.parse(email) : null,
      await hashPassword(password, { legacy: true }),
      true,
    );
    if (await this.repository.create(user)) return user;
    const winner = await this.repository.legacyOwner();
    if (!winner)
      throw new RuleError(
        "OWNER_CONFLICT",
        "原账号名称或邮箱已被使用，请检查迁移配置。",
        503,
      );
    return winner;
  }
  async register(input: unknown) {
    if (!registrationEnabled(this.runtime))
      throw new RuleError("REGISTRATION_DISABLED", "当前站点已关闭注册。", 403);
    const data = registrationSchema.parse(input);
    // Reserve the pre-existing owner before the first public registration can claim its name/email.
    const legacy = await this.repository.legacyOwner();
    const reservedNames = [
      this.runtime.env.APP_USERNAME &&
        normalizedName(this.runtime.env.APP_USERNAME),
      legacy?.username,
    ].filter(Boolean);
    const reservedEmail =
      this.runtime.env.APP_OWNER_EMAIL &&
      emailSchema.parse(this.runtime.env.APP_OWNER_EMAIL);
    if (
      reservedNames.includes(data.username) ||
      reservedNames.includes(data.email) ||
      data.email === reservedEmail
    )
      throw new RuleError("ACCOUNT_EXISTS", "账号或邮箱已被使用。", 409);
    const mail = this.mail();
    const user = this.newUser(
      data.username,
      data.email,
      await hashPassword(data.password),
    );
    if (!(await this.repository.create(user)))
      throw new RuleError("ACCOUNT_EXISTS", "账号或邮箱已被使用。", 409);
    await this.sendAction(user, "verify", data.email, mail);
  }
  async authenticate(identifier: string, password: string) {
    await this.bootstrap();
    const name = normalizedName(identifier);
    const user =
      (await this.repository.byUsername(name)) ??
      (await this.repository.byEmail(name));
    // Derive a real hash for unknown accounts as well, avoiding a cheap username timing oracle.
    const encoded =
      user?.passwordHash ??
      `scrypt$16384$8$5$${"0".repeat(32)}$${"0".repeat(64)}`;
    const valid = await verifyPassword(password, encoded);
    if (!user || !valid)
      throw new RuleError("INVALID_CREDENTIALS", "账号或密码不正确。", 401);
    if (!user.emailVerified)
      throw new RuleError(
        "EMAIL_NOT_VERIFIED",
        "请先验证邮箱，再登录。可在登录页面重新发送验证邮件。",
        403,
      );
    return user;
  }
  private async sendAction(
    user: User,
    purpose: UserAction["purpose"],
    email: string,
    mailer = this.mail(),
  ) {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const hash = await actionHash(token);
    await this.repository.saveAction({
      hash,
      userId: user.id,
      purpose,
      email,
      expiresAt: Date.now() + (purpose === "verify" ? 3600000 : 1800000),
      version: user.version,
    });
    const origin = this.runtime.env.APP_ORIGIN;
    if (!origin)
      throw new RuleError(
        "MISSING_CONFIGURATION",
        "请配置 APP_ORIGIN，以生成邮件链接。",
        503,
      );
    await mailer.send({
      to: email,
      purpose,
      url: `${new URL(origin).origin}/${purpose === "verify" ? "verify-email" : "reset-password"}#token=${token}`,
      id: hash,
    });
  }
  private async deliverRecoveryAction(
    user: User,
    purpose: UserAction["purpose"],
    email: string,
    mail: Mailer,
  ) {
    try {
      await this.sendAction(user, purpose, email, mail);
    } catch (e) {
      if (e instanceof RuleError && e.code === "EMAIL_DELIVERY_FAILED")
        console.warn("Account email delivery unavailable");
      else throw e;
    }
  }
  async resend(email: string) {
    const mail = this.mail(),
      user = await this.repository.byEmail(email);
    if (user && !user.emailVerified)
      await this.deliverRecoveryAction(user, "verify", email, mail);
  }
  async forgot(email: string) {
    const mail = this.mail(),
      user = await this.repository.byEmail(email);
    if (user?.emailVerified)
      await this.deliverRecoveryAction(user, "reset", email, mail);
  }
  async verify(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw invalidAction();
    const user = await this.repository.complete(
      await actionHash(token),
      "verify",
      Date.now(),
    );
    if (!user) throw invalidAction();
    return user;
  }
  async reset(token: string, password: string) {
    validatePassword(password);
    if (!/^[a-f0-9]{64}$/.test(token)) throw invalidAction();
    const hash = await actionHash(token),
      action = await this.repository.action(hash);
    if (!action || action.purpose !== "reset" || action.expiresAt <= Date.now())
      throw invalidAction();
    const user = await this.repository.complete(
      hash,
      "reset",
      Date.now(),
      await hashPassword(password),
    );
    if (!user) throw invalidAction();
  }
  async bindEmail(userId: string, email: string, password: string) {
    const user = await this.repository.byId(userId);
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      throw new RuleError("INVALID_CREDENTIALS", "当前密码不正确。", 401);
    if (user.email)
      throw new RuleError("EMAIL_ALREADY_SET", "账号已经绑定邮箱。", 409);
    if (await this.repository.byEmail(email))
      throw new RuleError("EMAIL_IN_USE", "邮箱已被其他账号使用。", 409);
    await this.sendAction(user, "verify", email);
  }
}
export async function accounts(runtime: AppRuntime, mailer?: Mailer) {
  return new Accounts(await accountRepository(runtime), runtime, mailer);
}
