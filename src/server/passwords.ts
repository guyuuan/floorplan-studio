import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { RuleError } from "../domain/engine";

// OWASP's 16 MiB scrypt profile; compatible with Workers node:crypto.
const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
export function validatePassword(password: string) {
  if (password.length < 8 || password.length > 24)
    throw new RuleError(
      "INVALID_PASSWORD",
      "密码长度需要为 8–24 个字符。",
      400,
    );
}
export async function hashPassword(
  password: string,
  options: { legacy?: boolean } = {},
) {
  if (options.legacy) {
    if (password.length < 8 || password.length > 256)
      throw new RuleError("INVALID_CONFIGURATION", "原账号密码长度无效。", 503);
  } else validatePassword(password);
  const salt = randomBytes(16).toString("hex");
  return `scrypt$16384$8$5$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  if (password.length > 256) return false;
  const match = encoded.match(
    /^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/,
  );
  if (!match) return false;
  return timingSafeEqual(
    await derive(password, match[1]),
    Buffer.from(match[2], "hex"),
  );
}
