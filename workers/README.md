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

### 本地验证

```bash
cd workers/notifications
pnpm test
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy pnpm check
```

`pnpm check` 只做 Wrangler dry-run，不验证 Cloudflare 账号、远端 D1、secrets、route 或真机 Web Push。

### 生产准备与部署

以下命令必须由具备 Cloudflare 权限的 controller 在 `workers/notifications/` 执行。本次 Task 9 不执行任何远端写操作；不得将返回的 D1 ID、VAPID 私钥或 token 编造或复制到日志。

1. 确认身份并创建独立 D1。`--update-config` 会把真实 `database_id` 写入 `wrangler.jsonc`，提交前必须人工核对账号和数据库名称：

   ```bash
   pnpm exec wrangler whoami
   pnpm exec wrangler d1 create billnest_notifications --binding NOTIFICATIONS_DB --update-config wrangler.jsonc
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

4. 使用可信本地工具只生成一次 VAPID key pair，然后交互写入 secrets。私钥不得提交到仓库、D1 或 shell history：

   ```bash
   pnpm exec wrangler secret put VAPID_PUBLIC_KEY
   pnpm exec wrangler secret put VAPID_PRIVATE_KEY
   pnpm exec wrangler secret put VAPID_SUBJECT
   ```

5. 先 dry-run，再部署。当前 `wrangler.jsonc` 的 `* * * * *` Cron 与 routes 会随部署生效：

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

还必须验证：配置接口只返回 VAPID 公钥和协议版本；Cloudflare Cron 每分钟触发；超过 15 分钟的 stale 提醒变为 expired 且不显示横幅；网络失败不影响本地 CRUD；请求中标题/正文保持密文；iOS/iPadOS 主屏 PWA、Android Chromium PWA 和桌面 Chromium 各完成前台、后台与关闭状态测试。浏览器需要 Push、Notification、Service Worker、IndexedDB、Web Crypto 与原生 Web Locks；缺少能力时 UI 必须显示 unsupported，而不是宣称后台提醒可用。

### 回滚

Worker 回滚与 D1 数据回滚必须分开处理。优先回滚 Worker 版本，不要把代码回滚误当成数据库回滚：

```bash
pnpm exec wrangler deployments list
pnpm exec wrangler rollback <previous-version-id> --message "rollback notifications release"
```

若 route 或 Cron 配置本身有问题，恢复上一版已审阅的 `wrangler.jsonc` 后重新 `pnpm exec wrangler deploy`。不要删除 D1 或 secrets 作为常规回滚手段。迁移发生数据问题时，停止写流量，使用 Cloudflare D1 自动备份/Time Travel 按事故时间点恢复，并在恢复前保留当前数据库；具体恢复动作由 controller 审批执行。
