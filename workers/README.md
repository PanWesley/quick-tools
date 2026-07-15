# BillNest Cloudflare Workers

Analytics 与 Notifications 使用独立 Worker、D1、路由和密钥。两者可复用无状态 HTTP/校验基础模块，但不得共享业务表、D1 binding、访问 token、VAPID 密钥或设备订阅。

## Analytics Worker

This Worker receives anonymous analytics events from `/tools/expense/` and stores daily aggregates in Cloudflare D1.

It does not store bill amounts, notes, tag names, or imported file contents. DAU uses a daily SHA-256 key derived from the request IP, user agent, date, and `ANALYTICS_SALT`; the raw IP is not stored.

## Cloudflare setup

1. Create a D1 database, for example `billnest_analytics`.
2. Deploy `workers/analytics-worker.mjs` with the D1 binding name `ANALYTICS_DB`.
3. Add two Worker variables:
   - `ANALYTICS_SALT`: any long random secret.
   - `ANALYTICS_READ_TOKEN`: a long random token for reading summaries.
4. Route both `billnest.top/api/analytics*` and `www.billnest.top/api/analytics*` to this Worker.
5. Keep the `www` DNS record proxied through Cloudflare. DNS-only records bypass Worker routes and go straight to Vercel.

## Endpoints

- `POST /api/analytics`: receives client events.
- `GET /api/analytics/summary?days=14&token=...`: returns daily DAU, sessions, pageviews, engaged seconds, and top routes.

## Notifications Worker

`workers/notifications/` 提供 `/api/notifications/*`、独立 Notifications D1 和每分钟 Cron。客户端上传 AES-GCM 密文；Worker 仍需保存安装级设备 ID、`notify_at`、revision、状态以及 PushSubscription endpoint/keys 才能调度和发送。AES-GCM key 只保存在客户端 IndexedDB，VAPID 私钥只进入 Cloudflare Worker Secret。

`device_id` 是浏览器/PWA 安装实例标识，不是硬件 ID；清除站点数据或重装后会变化。`devices.user_id` 与 `reminders.user_id` 保持 nullable，供未来账号绑定。

Notifications Worker 同时接受加密版本 1 和 2。PWA v2 使用可跨页面与 Service Worker 导入的本地密钥记录，未来提醒会在客户端正常同步时自动重加密；密钥和明文均不会上传。本次协议升级不修改 D1 schema，不需要执行新的 D1 migration。

Notifications JSON 请求体上限为 128 KiB；reconcile 每次最多接受 500 条、每个 ID 最多 128 字符的摘要。提醒写入使用已认证的 `POST /api/notifications/reminders/batch`，每批最多 25 个 operations，整个 Notifications JSON body 仍受 128 KiB 上限约束。客户端仍只投影本地日历 30 天，Worker 的 reminder validation 与 reconcile window 使用 `31 * 24h` 包络吸收全球时区和 DST 边界，不扩大客户端 horizon。

### 本地验证

```bash
cd workers/notifications
pnpm test
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy pnpm check
```

`pnpm check` 只做 Wrangler dry-run，不验证 Cloudflare 账号、远端 D1、secrets、route 或真机 Web Push。

### 自动生产部署

GitHub Actions 的 `Deploy production` 工作流是 `main` 的生产发布控制器，也可通过 `workflow_dispatch` 手动触发。`deploy-notifications` 会先安装依赖、运行 Worker 测试和 Wrangler dry-run，再部署 Notifications Worker；只有该 job 成功后，`deploy-vercel` 才会构建并发布同一提交到 Vercel。Worker 失败时 Vercel job 会被跳过，线上 PWA 保持上一版本。

`vercel.json` 禁止 Vercel Git 集成直接发布 `main`，避免它与 GitHub Actions 竞速；其他分支仍保留 PR Preview。GitHub 仓库仅保存以下 Actions Secrets，值不得写入变量、日志或仓库：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

Cloudflare token 应只允许目标账号和 `billnest.top` 的 Worker script/route 部署，Vercel token 应只作用于持有本项目的账号或 team。为 token 设置到期时间，并在到期前更新对应 GitHub Secret。`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY` 和 `VAPID_SUBJECT` 继续只存于 Cloudflare Worker Secrets；常规发布不创建 D1、不执行 migration，也不轮换 VAPID keys。

故障排查先查看两个 job 的边界：`deploy-notifications` 失败时检查测试、dry-run、Cloudflare token scope、Account ID、D1 binding 和 routes；`deploy-vercel` 失败时检查三个 Vercel Secret 是否属于同一个现有项目，以及 `vercel pull`、`vercel build`、`vercel deploy` 中最先失败的命令。修复配置后可从 Actions 页面手动重跑工作流。

两个平台必须独立回滚。Worker 使用下文的 `wrangler deployments list` 和 `wrangler rollback`；PWA 使用已链接项目的 Vercel CLI：

```bash
vercel list --prod
vercel rollback
vercel rollback status
```

需要恢复指定的已知良好部署时，可执行 `vercel rollback <deployment-id-or-url>`；Hobby 计划只支持回滚到紧邻的上一生产版本。回滚后用 `vercel promote <deployment-id-or-url>` 发布修复版本并恢复正常的生产域名指向。

### 生产准备与部署

以下命令必须由具备 Cloudflare 权限的 controller 在 `workers/notifications/` 执行；不得将 VAPID 私钥或 token 复制到日志或提交到仓库。

1. 确认身份并创建独立 D1。`--update-config` 会把真实 `database_id` 写入 `wrangler.jsonc`，提交前必须人工核对账号和数据库名称：

   ```bash
   pnpm exec wrangler whoami
   pnpm exec wrangler d1 create billnest_notifications --binding NOTIFICATIONS_DB --update-config
   ```

2. 审阅 `wrangler.jsonc`，确认只有一个 `compatibility_flags`，并包含真实 D1 binding、每分钟 Cron 与两个 route。route 由 `wrangler deploy` 随配置发布，不存在单独的 route 创建命令：

   ```jsonc
   {
     "d1_databases": [
       { "binding": "NOTIFICATIONS_DB", "database_name": "billnest_notifications", "database_id": "<wrangler 返回的真实 UUID>" }
     ],
     "triggers": { "crons": ["* * * * *"] },
     "routes": [
       { "pattern": "billnest.top/api/notifications*", "zone_name": "billnest.top" },
       { "pattern": "www.billnest.top/api/notifications*", "zone_name": "billnest.top" }
     ]
   }
   ```

3. 应用远端迁移。Wrangler 在每次 apply 前创建备份，失败的单个迁移会回滚：

   ```bash
   pnpm exec wrangler d1 migrations list NOTIFICATIONS_DB --remote
   pnpm exec wrangler d1 migrations apply NOTIFICATIONS_DB --remote
   ```

4. 使用可信本地工具只生成一次 VAPID key pair，然后交互写入 secrets。私钥不得提交到仓库、D1 或 shell history。首次创建 Worker 时，若 `secret put` 提示 Worker 不存在，先在不含生产 routes 的配置下完成一次初始 deploy，再写入 secrets，最后恢复 routes 并正式 deploy：

   ```bash
   pnpm exec wrangler secret put VAPID_PUBLIC_KEY
   pnpm exec wrangler secret put VAPID_PRIVATE_KEY
   pnpm exec wrangler secret put VAPID_SUBJECT
   ```

5. 添加并审阅真实的 `NOTIFICATIONS_DB` binding 与两条生产 routes 后，先 dry-run，再部署。必须先发布支持 `encryptionVersion: 2` 的 Worker，再发布 PWA v32 客户端，以保证客户端批处理请求到达已支持的服务端：

   ```bash
   env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy pnpm check
   pnpm exec wrangler deploy
   ```

### 生产验证

```bash
curl -fsS https://billnest.top/api/notifications/config
pnpm exec wrangler deployments list
pnpm exec wrangler d1 migrations list NOTIFICATIONS_DB --remote
```

还必须验证：配置接口只返回 VAPID 公钥和协议版本；Cloudflare Cron 每分钟触发；超过 15 分钟的 stale 提醒变为 expired 且不显示横幅；网络失败不影响本地 CRUD；请求中标题/正文保持密文；`pending` 状态在页面可见且在线时会按有界批次恢复；iOS/iPadOS 主屏 PWA、Android Chromium PWA 和桌面 Chromium 各完成前台、后台与关闭状态测试。生产检查不得包含真实设备 ID、token、endpoint、keys 或 payload。浏览器需要 Push、Notification、Service Worker、IndexedDB、Web Crypto 与原生 Web Locks；缺少能力时 UI 必须显示 unsupported，而不是宣称后台提醒可用。

### 回滚

Worker 回滚与 D1 数据回滚必须分开处理。优先回滚 Worker 版本，不要把代码回滚误当成数据库回滚：

```bash
pnpm exec wrangler deployments list
pnpm exec wrangler rollback <previous-version-id> --message "rollback notifications release"
```

若 route 或 Cron 配置本身有问题，恢复上一版已审阅的 `wrangler.jsonc` 后重新 `pnpm exec wrangler deploy`。不要删除 D1 或 secrets 作为常规回滚手段。迁移发生数据问题时，停止写流量，使用 Cloudflare D1 自动备份/Time Travel 按事故时间点恢复，并在恢复前保留当前数据库；具体恢复动作由 controller 审批执行。
