# Cloudflare Workers 部署

本项目保留 Next.js、React、Three.js，通过 OpenNext 打包到 Workers。D1 保存项目索引、版本指针和登录限流记录，私有 R2 保存户型、历史快照、原图和 PNG。网页支持用户名或邮箱登录、公开注册、邮箱验证与找回密码；每个用户的项目、图片和 MCP 权限独立隔离。外部 Agent 使用独立 Bearer Token 访问 `/api/mcp`，不包含内置聊天助手。

## 环境变量

复制 `.env.deploy.example` 为 `.env.deploy` 后填写，文件已被 Git 忽略。也可以从终端或 CI 注入相同变量。

| 变量                    | 用途                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `APP_ORIGIN`            | 完整 HTTPS 网站域名，如 `https://plan.example.com`，不带路径         |
| `APP_USERNAME`          | 可选，与 `APP_PASSWORD` 一起仅用于首次迁移原账号                     |
| `APP_PASSWORD`          | 可选，原账号密码（8–256 位，兼容旧密码）；仅首次导入使用             |
| `REGISTRATION_ENABLED`  | `true` 开放注册（默认），`false` 关闭注册；不会禁止已有用户登录      |
| `RESEND_API_KEY`        | Resend 发信密钥，保存为 Workers Secret                               |
| `EMAIL_FROM`            | 已在 Resend 验证域名的发件地址，如 `筑间 <noreply@example.com>`      |
| `APP_OWNER_EMAIL`       | 可选，首次导入原账号时由部署者指定的可信邮箱；也可登录后在账号页绑定 |
| `SESSION_SECRET`        | 签名会话的独立随机密钥，至少 32 位                                   |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID                                                   |
| `CLOUDFLARE_API_TOKEN`  | 部署 CLI 使用的 Cloudflare API Token；已有有效 Wrangler 登录时可省略 |
| `FLOORPLAN_D1_ID`       | 创建数据库后返回的 UUID                                              |
| `FLOORPLAN_D1_NAME`     | 可选，默认 `floorplan-studio-db`                                     |
| `FLOORPLAN_R2_BUCKET`   | 可选，默认 `floorplan-studio-files`                                  |
| `FLOORPLAN_WORKER_NAME` | 可选，默认 `floorplan-studio`                                        |
| `FLOORPLAN_CPU_MS`      | 可选，自定义 CPU 限额，需与账户套餐允许的范围一致                    |

运行 `openssl rand -hex 32` 生成会话密钥，且应与密码不同。MCP 令牌在登录后按账号生成，无需配置全站 `MCP_TOKEN`。不要把真实值提交 Git 或发到聊天中。

域名、账户及资源配置进入生成的 Wrangler 配置；原账号迁移凭据、会话密钥与 Resend 密钥通过标准输入写入 **Workers Secrets**，不会写进前端或生成的配置文件。Cloudflare API Token 只用于部署，不提供给网站或 Agent。

## 首次部署

需要 Node.js 22 LTS、npm、可用的 Cloudflare 账户，以及已经加入该账户的域名区域。API Token 需要对应账户 Workers 部署、D1、R2 和目标域名路由操作权限；也可以先执行 `npx wrangler login` 使用交互式授权。

```sh
npm ci
npx wrangler d1 create floorplan-studio-db
npx wrangler r2 bucket create floorplan-studio-files
```

使用 API Token 时，先在执行这些命令的终端注入 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。把创建返回的数据库 UUID 填入 `.env.deploy` 的 `FLOORPLAN_D1_ID`。R2 保持私有，不启用 `r2.dev` 或公开桶域名。

先在 Resend 验证发件域名并填写 `RESEND_API_KEY`、`EMAIL_FROM`；真实验证和找回密码邮件需要可用的发信服务。新站点无需配置 `APP_USERNAME`、`APP_PASSWORD`，直接注册账号。

填写全部部署配置后执行：

```sh
node --env-file=.env.deploy scripts/deploy-cloudflare.mjs
```

如果配置已由终端或 CI 环境变量注入，直接执行 `npm run deploy`。

脚本依次校验配置、构建 Workers 产物、应用远程 D1 迁移、发布 Worker 并绑定自定义域名、写入 Workers Secrets。生成配置位于被忽略的 `work/wrangler.production.json`。默认关闭 `workers.dev` 和版本预览地址。不要直接用基础 `wrangler.jsonc` 发布生产环境，它包含本地预览专用的资源占位值。

首次发布到 Secrets 写入完成前，业务接口会拒绝访问，不会降级为免登录模式；若 Secrets 写入失败，修复授权后重新执行部署命令。部署成功后，使用真实域名完成登录、创建项目、上传图片、2D/3D、导出及 MCP 验收。后续部署沿用相同命令，D1 仅执行尚未应用的迁移。

`APP_ORIGIN` 也是会话签发来源、CSRF 来源校验和 MCP 地址的依据。修改域名后重新部署并重新登录。用户通过邮件重置密码后，该用户的旧会话和 MCP 令牌立即失效，不影响其他用户；修改会话密钥或网站域名后，个人 MCP 令牌也会失效，需在网站重置后更新外部客户端。

## 本地 Workers 预览

```sh
cp .dev.vars.example .dev.vars
# 填写会话密钥和邮件服务变量，保留 APP_ORIGIN=http://127.0.0.1:8787
npm run db:migrate:local
npm run preview
```

打开 `http://127.0.0.1:8787` 登录。预览使用本机模拟 D1/R2，数据位于 `.wrangler/state/`，不会上传到线上。普通 `npm run dev` 仍使用原来的 `.data/` 存储，与 Workers 预览的数据独立。

## 远程 MCP

登录网页后，点击「连接 Agent」复制配置。服务地址为 `${APP_ORIGIN}/api/mcp`，采用无状态 Streamable HTTP，支持 POST，不提供 SSE 长连接。

Codex 配置示例（替换 URL）：

```toml
[mcp_servers.floorplan]
url = "https://plan.example.com/api/mcp"
bearer_token_env_var = "FLOORPLAN_MCP_TOKEN"
```

登录网站后，点击「连接 Agent」→「生成我的令牌」，复制返回的 MCP 配置。完整令牌只在生成时展示一次，关闭后无法再次读取；需要更换时点击「重置我的令牌」，旧令牌立即失效。服务端只保存令牌哈希，按用户名独立存入 D1；本地登录模式写入私有数据目录。

在启动 Codex 客户端的环境中设置 `FLOORPLAN_MCP_TOKEN` 为刚生成的个人令牌。其他客户端可直接使用生成配置中的 `Authorization: Bearer <个人令牌>`。网页登录和 CSRF 验证后才允许生成或重置；MCP 令牌不能用于这些网页操作。旧的全站 `MCP_TOKEN` 不再授权启用登录的服务，可从 Workers Secrets 删除。

新增迁移 `0003_multi_user.sql` 必须随部署执行。MCP 令牌现在绑定不可变用户 ID，只能读写该用户的项目；升级前的会话和令牌需重新登录、生成并配置。

MCP 令牌允许读写个人项目，但不能修改墙体分类、确认结构或调用用户迁移接口。结构核对仍需用户登录网页操作。网站 Cookie 不能替代 MCP 令牌，MCP 令牌也不能替代网页登录。

## 从本地 `.data` 迁移

先备份 `.data/` 并停止本地编辑。迁移保留项目 ID、revision、阶段、撤销/重做历史、原图和已保存的 PNG；源文件不改动。

```sh
# 只列出本地待迁移项目，不连接线上
npm run migrate:local

# 使用 .env.deploy 中的网站账号密码登录线上并执行迁移
node --env-file=.env.deploy --import tsx scripts/migrate-local.ts --apply
```

可用 `FLOORPLAN_DATA_DIR` 指定其他本地数据目录。线上已存在相同 ID 时跳过，不覆盖；中断后可重跑。迁移 API 仅允许用户会话和 CSRF 验证通过的请求，项目归属于当前用户。单个请求上限 18 MiB；历史和原图较大的旧项目若超限会失败，保留源备份后再处理。

普通 JSON 导入仍会建立新项目并重新进入结构核对；完整迁移与普通导入的用途不同。

## 验证与运维边界

```sh
npm test
npm run typecheck
npm run verify:cloudflare
npx wrangler deploy --dry-run --outdir work/worker-dry-run
```

测试覆盖真实本地 D1/R2 模拟、并发版本更新、历史恢复、登录与 CSRF、独立 MCP 权限和旧数据迁移。`verify:cloudflare` 构建后在 `127.0.0.1:8788` 启动独立模拟环境，使用公开测试凭据，结束后关闭自己启动的服务。它不发布生产资源，也不能代替线上账号和域名验收。

会话有效期 12 小时，Cookie 设置 HttpOnly、SameSite=Strict，HTTPS 下启用 Secure；写操作校验 Origin 与 CSRF。登录按来源 IP 限制为每 15 分钟最多 10 次尝试。注册需要唯一用户名与邮箱，新密码为 8–24 位；新账号验证邮箱后才能登录，支持用户名或邮箱登录；旧账号的已有长密码保留兼容，注册和重置统一使用 8–24 位。验证链接 1 小时有效，重置链接 30 分钟有效，均为一次性令牌，数据库只保存哈希；重发会使同用途旧链接失效。密码使用带独立随机盐的 scrypt 哈希保存。找回和重发接口返回统一提示，并按 IP 和收件邮箱限流。

项目编辑使用 D1 revision 条件更新发布 R2 状态，冲突返回 409。逻辑撤销历史保留最多 40 步；旧状态及未被引用的 R2 对象暂不自动清理，存储会随编辑增加。备份和垃圾回收需要后续单独配置。切勿仅按对象年龄删除仍被 D1 或历史快照引用的对象。

大图、复杂方案、批量命令和 Next.js 产物会消耗 Workers CPU、请求及存储配额；本地打包成功不代表目标账户额度足够。上线时以实际 Cloudflare 部署结果和真实方案验收为准。

实现依据：[OpenNext Cloudflare 部署指南](https://opennext.js.org/cloudflare/get-started)、[Cloudflare D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)、[Wrangler Secrets](https://developers.cloudflare.com/workers/wrangler/commands/workers/)。

## 从单账号升级

1. 保留原 `APP_USERNAME`、`APP_PASSWORD`，部署并应用所有 D1 迁移。
2. 原账号首次成功登录时导入为持久化用户，认领尚未归属的旧项目；新注册用户无法认领旧项目。旧 R2 文件仍可读取，本地旧数据保留原始副本。
3. 原账号可在右上角账号页绑定并验证邮箱，启用找回密码。`APP_OWNER_EMAIL` 仅在首次导入时使用，由部署者保证其归属。
4. 此后修改环境变量账号密码不会修改已导入账号。密码通过网站邮件流程重置；不要靠更改 `APP_USERNAME` 转移旧项目。完成迁移后可移除这两个迁移变量。
5. 所有用户重新生成个人 MCP 令牌。修改会话密钥会全站撤销已有会话与令牌。

`REGISTRATION_ENABLED=false` 只关闭新注册，已有账号仍可验证邮箱、登录、找回密码。当前未提供团队共享、管理员读取他人项目或修改用户名的功能。

本地 Next 开发若要启用账号，请在 `.env.local` 配置 `SESSION_SECRET`、`APP_ORIGIN` 及邮件变量；完全不配置鉴权变量时仍保留仅回环地址可用的免登录模式。

邮件接口依据：[Resend Send Email](https://resend.com/docs/api-reference/emails/send-email)。密码参数依据：[OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)，使用 N=16384、r=8、p=5 的 scrypt 配置，通过 Workers `node:crypto` 运行。
