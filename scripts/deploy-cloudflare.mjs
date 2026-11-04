import { spawn } from "node:child_process";
import path from "node:path";
import {
  root,
  writeDeploymentConfig,
  deploymentSettings,
} from "./cloudflare-config.mjs";
function run(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, "node_modules/wrangler/bin/wrangler.js"), ...args],
      {
        cwd: root,
        env: process.env,
        stdio: [input ? "pipe" : "inherit", "inherit", "inherit"],
      },
    );
    if (input) child.stdin.end(input);
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Wrangler 退出码 ${code}`)),
    );
  });
}
try {
  const config = await writeDeploymentConfig(),
    settings = deploymentSettings();
  // The artifact is built before changing live resources; initial requests fail closed until secrets exist.
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "cf:build"], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Workers 构建失败")),
    );
  });
  await run([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    config,
  ]);
  await run(["deploy", "--config", config]);
  const secrets = {
    APP_USERNAME: process.env.APP_USERNAME,
    APP_PASSWORD: process.env.APP_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
    MCP_TOKEN: process.env.MCP_TOKEN,
  };
  await run(["secret", "bulk", "--config", config], JSON.stringify(secrets));
  console.log(
    `已部署：${settings.origin}。请完成网页登录和远程 MCP 的真实账号验收。`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
