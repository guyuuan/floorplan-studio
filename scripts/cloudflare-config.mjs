import path from "node:path";
import { parse } from "jsonc-parser";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** @param {Record<string, string | undefined>} env */
export function deploymentSettings(env = process.env) {
  const required = [
    "APP_ORIGIN",
    "APP_USERNAME",
    "APP_PASSWORD",
    "SESSION_SECRET",
    "CLOUDFLARE_ACCOUNT_ID",
    "FLOORPLAN_D1_ID",
  ];
  const missing = required.filter(
    (k) => !env[k] || /^(replace-|your-)/.test(env[k]),
  );
  if (missing.length)
    throw new Error(`请先设置环境变量：${missing.join(", ")}`);
  const origin = new URL(env.APP_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    ["localhost", "127.0.0.1"].includes(origin.hostname) ||
    origin.hostname.endsWith(".example")
  )
    throw new Error("APP_ORIGIN 必须是计划绑定的真实 HTTPS 域名，不包含路径。");
  if (env.APP_PASSWORD.length < 12 || env.SESSION_SECRET.length < 32)
    throw new Error("APP_PASSWORD 至少 12 位，SESSION_SECRET 至少 32 位。");
  if (env.APP_PASSWORD === env.SESSION_SECRET)
    throw new Error("登录密码和会话密钥必须分别设置。");
  if (
    !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID) ||
    !/^[a-f0-9-]{36}$/i.test(env.FLOORPLAN_D1_ID)
  )
    throw new Error("请提供真实的 CLOUDFLARE_ACCOUNT_ID 和 FLOORPLAN_D1_ID。");
  const name = env.FLOORPLAN_WORKER_NAME ?? "floorplan-studio",
    bucket = env.FLOORPLAN_R2_BUCKET ?? "floorplan-studio-files";
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
  )
    throw new Error("Worker / R2 名称格式无效。");
  return { origin: origin.origin, hostname: origin.hostname, name, bucket };
}
/** @param {Record<string, string | undefined>} env */
export async function writeDeploymentConfig(env = process.env) {
  const settings = deploymentSettings(env);
  const config = parse(
    await readFile(path.join(root, "wrangler.jsonc"), "utf8"),
  );
  Object.assign(config, {
    name: settings.name,
    account_id: env.CLOUDFLARE_ACCOUNT_ID,
    main: path.join(root, ".open-next/worker.js"),
    assets: {
      ...config.assets,
      directory: path.join(root, ".open-next/assets"),
    },
    services: [{ binding: "WORKER_SELF_REFERENCE", service: settings.name }],
    routes: [{ pattern: settings.hostname, custom_domain: true }],
    vars: { FLOORPLAN_STORAGE: "cloudflare", APP_ORIGIN: settings.origin },
  });
  config.d1_databases = [
    {
      binding: "DB",
      database_name: env.FLOORPLAN_D1_NAME ?? "floorplan-studio-db",
      database_id: env.FLOORPLAN_D1_ID,
      migrations_dir: path.join(root, "migrations"),
    },
  ];
  config.r2_buckets = [{ binding: "FILES", bucket_name: settings.bucket }];
  delete config.limits;
  if (env.FLOORPLAN_CPU_MS) {
    const value = Number(env.FLOORPLAN_CPU_MS);
    if (!Number.isInteger(value) || value < 1 || value > 300000)
      throw new Error("FLOORPLAN_CPU_MS 无效。");
    config.limits = { cpu_ms: value };
  }
  const output = path.join(root, "work/wrangler.production.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(config, null, 2) + "\n");
  // Passwords and tokens are deliberately absent from the generated deployment manifest.
  return output;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(await writeDeploymentConfig());
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
