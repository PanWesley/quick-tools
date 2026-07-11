# 今日有序可靠 Web Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `tools/time` 增加匿名安装级设备身份、端侧加密提醒和 Cloudflare Worker 后台 Web Push，并移除回到前台后逐条补发过期通知的行为。

**Architecture:** 新建独立 `billnest-notifications` Worker 和 Notifications D1，HTTP API 负责设备、订阅和提醒，Cron 每分钟领取到期记录并通过标准 Web Push 发送密文。浏览器端将设备凭证、AES-GCM 密钥和同步队列保存在 IndexedDB；现有本地通知保留为前台精确补充，Service Worker 接收 Push 后解密并显示简洁横幅。

**Tech Stack:** 原生 HTML/CSS/JavaScript、IndexedDB、Web Crypto AES-GCM、Push API、Notifications API、Service Worker、Cloudflare Workers、D1、Cron Triggers、`@block65/webcrypto-web-push@1.0.2`、Node.js `node:test`、Wrangler 4.110.0。

## Global Constraints

- 本地任务和习惯写入必须在后端不可用时继续成功。
- 后端不得接收任务备注、每日一句、完整任务或明文通知标题。
- 设备 ID 是安装级标识；清除站点数据或重装后允许变化。
- 通知加密密钥不得离开设备 IndexedDB。
- 后台调度误差目标为一分钟以内，通知有效期固定为 15 分钟。
- 超过 15 分钟的提醒不得作为系统横幅补发。
- Analytics Worker、Analytics D1、通知 Worker 和 Notifications D1 必须隔离。
- 生产来源仅允许 `https://billnest.top` 和 `https://www.billnest.top`；其他来源通过 `ALLOWED_ORIGINS` 显式配置。
- 所有设备级写接口使用 `Authorization: Bearer <device_token>`，URL 中不得出现 token。
- 使用以下运行时执行本计划中的 Node 和 pnpm 命令：

```bash
export NODE=/Users/wesley/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
export PNPM=/Users/wesley/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
```

---

## File Map

### Worker

- Create `workers/notifications/package.json`: 固定 Worker 依赖和测试命令。
- Create `workers/notifications/pnpm-lock.yaml`: 锁定依赖解析结果。
- Create `workers/notifications/wrangler.jsonc`: Worker、Cron、D1 和允许来源配置。
- Create `workers/notifications/migrations/0001_initial.sql`: devices、push_subscriptions、reminders 表和索引。
- Create `workers/notifications/core.mjs`: 鉴权解析、输入校验、token 哈希、错误分类和重试计算。
- Create `workers/notifications/repository.mjs`: Notifications D1 的唯一访问层。
- Create `workers/notifications/app.mjs`: 可注入 repository 和 push sender 的 HTTP/Cron 用例。
- Create `workers/notifications/web-push.mjs`: `@block65/webcrypto-web-push` 封装。
- Create `workers/notifications/worker.mjs`: Cloudflare `fetch` 和 `scheduled` 入口。
- Create `workers/notifications/*.test.mjs`: schema、core、HTTP、Cron 和 Web Push wrapper 测试。

### PWA client

- Create `tools/time/js/notification-crypto.js`: AES-GCM、base64url 和通知专用 IndexedDB key store。
- Create `tools/time/js/notification-model.js`: 通知文案、提醒投影、稳定 ID 和 revision。
- Create `tools/time/js/notification-sync.js`: 设备注册、PushSubscription、API、队列与对账。
- Create matching `*.test.js` files: Node 单元测试。
- Modify `tools/time/js/notification.js`: 修正习惯时间、简化前台通知并提供应用内错过摘要。
- Modify `tools/time/js/app.js`: 通知设置状态、启用/测试流程、同步生命周期与点击定位。
- Modify `tools/time/index.html`: 加载新模块并更新通知文案。
- Modify `tools/time/sw.js`: 处理 `push`、端侧解密、去重和点击定位。
- Modify `tools/time/css/style.css`: 仅增加通知同步状态和定位高亮所需样式。
- Modify `tools/time/README.md`, `tools/time/CHANGELOG.md`, `workers/README.md`: 记录真实能力、隐私边界和部署步骤。

---

### Task 1: Worker package and D1 schema

**Files:**
- Create: `workers/notifications/package.json`
- Create: `workers/notifications/schema.test.mjs`
- Create: `workers/notifications/migrations/0001_initial.sql`
- Create: `workers/notifications/wrangler.jsonc`
- Create: `workers/notifications/pnpm-lock.yaml`

**Interfaces:**
- Produces: D1 tables `devices`, `push_subscriptions`, `reminders` and indexes consumed by `repository.mjs`.

- [ ] **Step 1: Write the failing schema test**

Create a Node test that loads the migration, applies it to an in-memory SQLite database through `/usr/bin/sqlite3`, and asserts the exact tables and reminder indexes:

```js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('initial migration creates isolated notification tables and due indexes', () => {
  const migration = readFileSync(new URL('./migrations/0001_initial.sql', import.meta.url), 'utf8');
  const query = `${migration}\nSELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name;`;
  const output = execFileSync('/usr/bin/sqlite3', [':memory:'], { input: query, encoding: 'utf8' });
  for (const name of ['devices', 'push_subscriptions', 'reminders', 'idx_reminders_due', 'idx_reminders_device_source']) {
    assert.match(output, new RegExp(`^${name}$`, 'm'));
  }
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
$NODE --test workers/notifications/schema.test.mjs
```

Expected: FAIL with `ENOENT` for `migrations/0001_initial.sql`.

- [ ] **Step 3: Add package, configuration, and migration**

`package.json` must pin:

```json
{
  "name": "billnest-notifications-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test *.test.mjs",
    "dev": "wrangler dev --test-scheduled",
    "check": "wrangler deploy --dry-run"
  },
  "dependencies": {
    "@block65/webcrypto-web-push": "1.0.2"
  },
  "devDependencies": {
    "wrangler": "4.110.0"
  }
}
```

`wrangler.jsonc` must define `name`, `main`, `compatibility_date`, `triggers.crons: ["* * * * *"]`, `ALLOWED_ORIGINS`, and leave D1 creation to Wrangler's `--update-config` command. The migration must use `CREATE TABLE IF NOT EXISTS`, foreign keys, the seven approved reminder states, a unique reminder `id`, and non-unique indexes `(status, notify_at)` plus `(device_id, source_id_hash)` so recurring items may keep multiple future reminder instances.

- [ ] **Step 4: Install dependencies and verify GREEN**

Run:

```bash
cd workers/notifications
$PNPM install
cd ../..
$NODE --test workers/notifications/schema.test.mjs
```

Expected: one passing test and a generated `pnpm-lock.yaml`.

- [ ] **Step 5: Commit**

```bash
git add workers/notifications
git commit -m "feat(notifications): add worker schema and runtime"
```

### Task 2: Worker core validation and security primitives

**Files:**
- Create: `workers/notifications/core.test.mjs`
- Create: `workers/notifications/core.mjs`

**Interfaces:**
- Produces: `allowedOrigin(request, env)`, `parseBearer(request)`, `createDeviceCredentials(crypto)`, `hashDeviceToken(token, crypto)`, `validateSubscription(value)`, `validateReminder(value, now)`, `classifyPushStatus(status)`, `retryAt(attempt, now)`, `json(data, status, origin)`.

- [ ] **Step 1: Write failing core tests**

Cover these exact behaviors:

```js
test('bearer tokens never come from query strings', () => {
  const request = new Request('https://billnest.top/api/notifications/devices/id?token=leak', {
    headers: { Authorization: 'Bearer secret-token' }
  });
  assert.equal(parseBearer(request), 'secret-token');
});

test('reminders accept ciphertext but reject plaintext fields', () => {
  const valid = validateReminder({
    tool: 'time', sourceIdHash: 'a'.repeat(64), notifyAt: '2026-07-11T10:30:00.000Z',
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1, revision: 3
  }, new Date('2026-07-11T10:00:00.000Z'));
  assert.equal(valid.ok, true);
  assert.equal(validateReminder({ ...valid.value, title: '项目周会' }, new Date()).ok, false);
});

test('push status classification separates retryable and permanent failures', () => {
  assert.equal(classifyPushStatus(201), 'sent');
  assert.equal(classifyPushStatus(410), 'invalid_subscription');
  assert.equal(classifyPushStatus(503), 'retry');
});
```

Also test origin allowlisting, UUID/token entropy shape, deterministic SHA-256 token hashing, subscription key validation, 30-day maximum schedule range, revision integers, response headers, and capped retry delays.

- [ ] **Step 2: Verify RED**

Run `$NODE --test workers/notifications/core.test.mjs`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `core.mjs`.

- [ ] **Step 3: Implement the pure core**

Use explicit field allowlists and return `{ ok: true, value }` or `{ ok: false, code, message }`. Device credentials use `crypto.randomUUID()` for the ID and 32 random bytes encoded as base64url for the token. Hash the high-entropy token with SHA-256. Retry delays are 1, 5, and 15 minutes; attempts above three become terminal failure.

- [ ] **Step 4: Verify GREEN**

Run `$NODE --test workers/notifications/core.test.mjs`.

Expected: all core tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/notifications/core.mjs workers/notifications/core.test.mjs
git commit -m "feat(notifications): validate and secure device requests"
```

### Task 3: D1 repository and HTTP API

**Files:**
- Create: `workers/notifications/repository.mjs`
- Create: `workers/notifications/app.mjs`
- Create: `workers/notifications/app.test.mjs`

**Interfaces:**
- Consumes: Task 1 schema and Task 2 core functions.
- Produces: `createNotificationApp({ repository, sendPush, now, crypto })` with `fetch(request, env)` and `runScheduled(env)`.
- Produces repository methods: `createDevice`, `authenticateDevice`, `upsertSubscription`, `removeSubscription`, `upsertReminder`, `cancelReminder`, `cancelDeviceReminders`, `reconcile`, `claimDue`, `markSent`, `markRetry`, `markFailed`, `invalidateSubscription`, `expireStale`, `releaseExpiredLeases`.

- [ ] **Step 1: Write failing API tests with an in-memory repository**

Test the complete route contract:

```js
function jsonRequest(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json', Origin: 'https://billnest.top' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://billnest.top${path}`, { method, headers, body: JSON.stringify(body) });
}

test('anonymous registration returns one device token and stores only its hash', async () => {
  const response = await app.fetch(jsonRequest('/api/notifications/devices', 'POST', {
    platform: 'mobile', timezone: 'Asia/Shanghai', clientVersion: '0.7.0'
  }), env);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.deviceId, /^[0-9a-f-]{36}$/);
  assert.ok(body.deviceToken.length >= 40);
  assert.notEqual(repository.devices[0].tokenHash, body.deviceToken);
});

test('older reminder revisions cannot overwrite a newer reminder', async () => {
  const registration = await app.fetch(jsonRequest('/api/notifications/devices', 'POST', {
    platform: 'mobile', timezone: 'Asia/Shanghai', clientVersion: '0.7.0'
  }), env);
  const credentials = await registration.json();
  const put = (revision, notifyAt) => app.fetch(jsonRequest('/api/notifications/reminders/reminder-1', 'PUT', {
    tool: 'time', sourceIdHash: 'a'.repeat(64), notifyAt,
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1, revision
  }, credentials.deviceToken), env);
  await put(4, '2026-07-11T10:30:00.000Z');
  const response = await put(3, '2026-07-11T11:30:00.000Z');
  assert.equal(response.status, 409);
});
```

Also cover `GET /config`, unauthorized access, subscription replacement and deletion, equal-revision idempotency, cancellation, 30-day reconcile summaries, encrypted test payload rate limiting through repository state, 404s, 405s, payload size limit, and CORS rejection. Deleting a subscription must cancel all future reminders for that device.

- [ ] **Step 2: Verify RED**

Run `$NODE --test workers/notifications/app.test.mjs`.

Expected: FAIL because `app.mjs` does not exist.

- [ ] **Step 3: Implement app routing and repository**

`GET /api/notifications/config` returns the runtime equivalent of:

```js
json({ protocolVersion: 1, vapidPublicKey: env.VAPID_PUBLIC_KEY }, 200, origin)
```

The runtime value must be read from `env.VAPID_PUBLIC_KEY`; no key is committed. Route handlers authenticate by hashing the bearer token and comparing it with the device row. D1 statements use bound parameters only. `upsertReminder` performs revision checks in SQL and restores a higher-revision cancelled reminder to `pending`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
$NODE --test workers/notifications/core.test.mjs workers/notifications/app.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/notifications/repository.mjs workers/notifications/app.mjs workers/notifications/app.test.mjs
git commit -m "feat(notifications): add device and reminder API"
```

### Task 4: Web Push sender and Cron state machine

**Files:**
- Create: `workers/notifications/web-push.mjs`
- Create: `workers/notifications/web-push.test.mjs`
- Create: `workers/notifications/worker.mjs`
- Modify: `workers/notifications/app.mjs`
- Modify: `workers/notifications/app.test.mjs`

**Interfaces:**
- Consumes: `buildPushPayload` from `@block65/webcrypto-web-push`.
- Produces: `sendWebPush({ subscription, encryptedPayload, env, fetchImpl }) -> { status, body }`.
- Produces Cloudflare handlers `fetch(request, env)` and `scheduled(controller, env, ctx)`.

- [ ] **Step 1: Write failing sender and Cron tests**

Verify that the sender builds this message shape and never decrypts the application payload:

```js
assert.deepEqual(buildCalls[0].message, {
  data: JSON.stringify(encryptedPayload),
  options: { ttl: 900, urgency: 'normal', topic: 'reminder-id' }
});
```

Cron tests must prove: expired leases are released; reminders older than 15 minutes become `expired`; only claimed rows are sent; 201 becomes `sent`; 404/410 invalidates the subscription; 429/500/503 retry up to three attempts; an already cancelled row is never sent; a batch is capped at 100.

- [ ] **Step 2: Verify RED**

Run:

```bash
$NODE --test workers/notifications/web-push.test.mjs workers/notifications/app.test.mjs
```

Expected: FAIL because `web-push.mjs` and scheduled behavior are absent.

- [ ] **Step 3: Implement sender, scheduled use case, and Worker entry**

Use:

```js
const requestInit = await buildPushPayload(
  { data: JSON.stringify(encryptedPayload), options: { ttl: 900, urgency: 'normal', topic } },
  subscription,
  { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
);
const response = await fetchImpl(subscription.endpoint, requestInit);
```

The scheduled handler calls `ctx.waitUntil(app.runScheduled(env))`. It must not log endpoints, subscription keys, authorization tokens, VAPID keys, or encrypted payloads.

- [ ] **Step 4: Verify GREEN and Worker bundle**

Run:

```bash
cd workers/notifications
$PNPM test
$PNPM check
```

Expected: all Worker tests pass and Wrangler dry-run bundles successfully.

- [ ] **Step 5: Commit**

```bash
git add workers/notifications
git commit -m "feat(notifications): send due reminders with web push"
```

### Task 5: Browser encryption and persistent installation state

**Files:**
- Create: `tools/time/js/notification-crypto.test.js`
- Create: `tools/time/js/notification-crypto.js`
- Create: `tools/time/js/notification-sync.test.js`
- Create: `tools/time/js/notification-sync.js`

**Interfaces:**
- Produces `TodayYouxuNotificationCrypto`: `getOrCreateKey()`, `encryptPayload(key, value)`, `decryptPayload(key, envelope)`, `base64UrlEncode`, `base64UrlDecode`.
- Produces `TodayYouxuNotificationSync.create(options)`: `setup(registration)`, `getStatus()`, `enable()`, `disable()`, `sync(data, todayKey, habitDueChecker)`, `sendTest()`, `handleOnline()`, `handleForeground()`.

- [ ] **Step 1: Write failing crypto tests**

```js
test('AES-GCM round trips notification payload and uses a fresh IV', async () => {
  const key = await cryptoApi.generateKey();
  const first = await cryptoApi.encryptPayload(key, { title: '项目周会', body: '10:30 · 工作' });
  const second = await cryptoApi.encryptPayload(key, { title: '项目周会', body: '10:30 · 工作' });
  assert.notEqual(first.iv, second.iv);
  assert.deepEqual(await cryptoApi.decryptPayload(key, first), { title: '项目周会', body: '10:30 · 工作' });
});
```

Also assert version rejection, tamper failure, Unicode content, and that the key-store API requests a non-extractable AES-GCM 256-bit key.

- [ ] **Step 2: Verify crypto RED**

Run `$NODE --test tools/time/js/notification-crypto.test.js`.

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement crypto module and verify GREEN**

Use a UMD wrapper so Node tests use `module.exports` and both the page and Service Worker use `self.TodayYouxuNotificationCrypto`. Store the key in a dedicated IndexedDB database `todayYouxuNotificationDB`, version 1, object store `secrets`, record key `payload-key-v1`.

Run `$NODE --test tools/time/js/notification-crypto.test.js`.

Expected: all crypto tests pass.

- [ ] **Step 4: Write failing installation and queue tests**

Inject `fetch`, storage, crypto, registration, clock and online status. Cover stable device reuse, lost network queueing, bearer headers, public VAPID key conversion, `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, token redaction, exponential queue retry, authentication reset, and subscription renewal.

- [ ] **Step 5: Implement sync state and verify GREEN**

Persist installation, queue and sync metadata in `todayYouxuNotificationDB` stores `installation`, `queue`, and `meta`. Never put `deviceToken` in localStorage. `disable()` first queues cancellation of future reminders, calls `DELETE /devices/:id/subscription`, then unsubscribes the browser subscription and marks local state disabled; network failure leaves a visible `pending` state until cleanup succeeds. API methods return typed statuses: `disabled`, `unsupported`, `permission-required`, `subscribing`, `syncing`, `ready`, `pending`, `error`.

Run:

```bash
$NODE --test tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add tools/time/js/notification-crypto.js tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.js tools/time/js/notification-sync.test.js
git commit -m "feat(time): persist encrypted notification devices"
```

### Task 6: Reminder projection and concise notification copy

**Files:**
- Create: `tools/time/js/notification-model.test.js`
- Create: `tools/time/js/notification-model.js`
- Modify: `tools/time/js/notification.js`
- Create: `tools/time/js/notification.test.js`

**Interfaces:**
- Produces `TodayYouxuNotificationModel.buildReminderRecords(data, todayKey, habitDueChecker, now)`.
- Each record contains `{ id, sourceIdHash, notifyAt, revision, encryptedValue }` where `encryptedValue` contains `{ title, body, tag, data, scheduledAt, v }`.
- Produces `buildNotificationCopy(type, item, dueTime, notifyTime)`.

- [ ] **Step 1: Write failing copy and projection tests**

Assert the approved templates exactly:

```js
const at = (time) => new Date(`2026-07-11T${time}:00+08:00`);

assert.deepEqual(buildNotificationCopy('task', task, at('10:30'), at('10:30')), {
  title: '项目周会', body: '10:30 · 工作'
});
assert.deepEqual(buildNotificationCopy('task', task, at('10:30'), at('10:15')), {
  title: '项目周会', body: '10:30 开始 · 还有 15 分钟'
});
assert.deepEqual(buildNotificationCopy('habit', habit, at('09:00'), at('09:00')), {
  title: '喝水', body: '今日打卡 · 健康'
});
```

Also cover all-day tasks, empty titles, all seven areas, custom reminders, stable IDs, update revisions from `updatedAt`, inactive/deleted/completed filtering, 30-day horizon, recurring habit dates, and habit `startTime` instead of hard-coded 09:00.

- [ ] **Step 2: Verify RED**

Run:

```bash
$NODE --test tools/time/js/notification-model.test.js tools/time/js/notification.test.js
```

Expected: FAIL because the model module is missing and habit time remains hard-coded.

- [ ] **Step 3: Implement model and narrow legacy notification service**

Move copy/projection logic into the pure model module. In `notification.js`, change `getHabitDateTime()` to read valid `HH:mm` from `habit.startTime`, defaulting to 09:00. Replace twelve-hour per-item missed notifications with `getMissedCount()` so app code can show one in-app toast. Keep foreground scheduling limited to the next 24 hours.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
$NODE --test tools/time/js/notification-model.test.js tools/time/js/notification.test.js tools/time/js/app-state.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/time/js/notification-model.js tools/time/js/notification-model.test.js tools/time/js/notification.js tools/time/js/notification.test.js
git commit -m "fix(time): simplify reminder copy and stale handling"
```

### Task 7: Connect encrypted reconciliation to app lifecycle

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/css/style.css`
- Create: `tools/time/js/notification-integration.test.js`

**Interfaces:**
- Consumes: Tasks 5 and 6 client modules.
- Produces: UI states and lifecycle calls without changing local CRUD semantics.

- [ ] **Step 1: Write a failing asset and integration contract test**

The test reads source files and asserts script order, cache-busted assets, status copy, and required lifecycle calls:

```js
assert.ok(index.indexOf('notification-crypto.js') < index.indexOf('notification-sync.js'));
assert.ok(index.indexOf('notification-model.js') < index.indexOf('notification-sync.js'));
assert.match(app, /NotificationSync\.enable\(\)/);
assert.match(app, /NotificationSync\.sync\(data, appState\.todayKey, State\.habitDueOn\)/);
assert.doesNotMatch(app, /checkMissedReminders\(/);
```

- [ ] **Step 2: Verify RED**

Run `$NODE --test tools/time/js/notification-integration.test.js`.

Expected: FAIL because the new assets and lifecycle calls are absent.

- [ ] **Step 3: Integrate setup, enable, test, sync, and status UI**

Load `notification-crypto.js`, `notification-model.js`, and `notification-sync.js` before `notification.js` and `app.js`. After Service Worker registration, initialize one sync service. The notification button must:

- request permission only from the user click;
- register device and PushSubscription;
- reconcile current data;
- send an encrypted backend test when status is ready;
- show actionable errors without disabling local task entry.

After every successful `DB.getAllData()`, call `NotificationSync.sync(data, todayKey, habitDueOn)`. On `online` and foreground events, drain the queue and reconcile. Replace old missed system notifications with one toast from `getMissedCount()`.

- [ ] **Step 4: Add restrained UI states**

Use existing status pill styles with additions for `syncing`, `pending`, and `error`. Copy must be short: `正在连接`, `等待同步`, `后台提醒已开启`, `需要重新授权`. Do not add a new card or explanatory feature block.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
$NODE --test tools/time/js/notification-integration.test.js tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.test.js tools/time/js/notification-model.test.js tools/time/js/notification.test.js
$NODE --check tools/time/js/app.js
```

Expected: all tests and syntax checks pass.

- [ ] **Step 6: Commit**

```bash
git add tools/time/index.html tools/time/js/app.js tools/time/css/style.css tools/time/js/notification-integration.test.js
git commit -m "feat(time): sync reminders with notification backend"
```

### Task 8: Service Worker push decryption and task targeting

**Files:**
- Modify: `tools/time/sw.js`
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/js/notification-crypto.js`
- Create: `tools/time/js/service-worker-notification.test.js`

**Interfaces:**
- Consumes: encrypted Web Push envelope and local AES key.
- Produces: visible notification options and `{ type, id, date, url }` click targeting.

- [ ] **Step 1: Write failing Service Worker behavior tests**

Use a VM-style Service Worker harness with fake `self`, `registration`, `clients`, caches and IndexedDB key adapter. Assert:

- `push` decrypts the payload and calls `showNotification` once;
- decryption failure shows `你有一项提醒 / 打开今日有序查看详情`;
- the same tag is not displayed twice;
- `notificationclick` focuses an existing time client or opens the target URL;
- the page receives `NOTIFICATION_CLICK` and scrolls/highlights the matching task or habit;
- no notification payload is logged.

- [ ] **Step 2: Verify RED**

Run `$NODE --test tools/time/js/service-worker-notification.test.js`.

Expected: FAIL because `push` handling is absent.

- [ ] **Step 3: Implement push, fallback, dedupe, and targeting**

Load the shared crypto helper with `importScripts('/tools/time/js/notification-crypto.js?v=1')`. In the `push` handler, parse only `{ v, iv, ciphertext }`, load the key, decrypt, validate the payload shape, and call `registration.showNotification(title, options)`. Use `registration.getNotifications({ tag })` to suppress an already visible tag. Store the tag in the existing local notified log only when a page is available; correctness must not depend on page localStorage.

Add stable entity attributes to rendered rows and a page helper that switches to today, selects the date when present, scrolls the entity into view, and applies a short non-layout-shifting highlight.

- [ ] **Step 4: Bump Service Worker cache and asset versions**

Cache all three new notification scripts, update `CACHE_NAME`, and keep `/api/notifications` network-only so responses never enter the static cache.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
$NODE --test tools/time/js/service-worker-notification.test.js tools/time/js/notification-integration.test.js
$NODE --check tools/time/sw.js
```

Expected: tests and syntax check pass.

- [ ] **Step 6: Commit**

```bash
git add tools/time/sw.js tools/time/js/app.js tools/time/js/notification-crypto.js tools/time/js/service-worker-notification.test.js
git commit -m "feat(time): receive encrypted background push"
```

### Task 9: Documentation, full verification, and Cloudflare handoff

**Files:**
- Modify: `tools/time/README.md`
- Modify: `tools/time/CHANGELOG.md`
- Modify: `workers/README.md`
- Modify: `docs/superpowers/specs/2026-07-11-time-web-push-backend-design.md`

**Interfaces:**
- Produces: accurate user/deployment documentation and a verified release candidate.

- [ ] **Step 1: Update documentation**

Document: install-level device identity, 15-minute stale limit, end-to-end application payload encryption, backend-unavailable behavior, supported PWA contexts, D1 migration, VAPID secrets, Cron, and route setup. Remove the inaccurate statement that the existing Service Worker alone schedules background notifications.

- [ ] **Step 2: Run complete automated verification**

```bash
$NODE --test tools/time/js/date-utils.test.js tools/time/js/export.test.js tools/time/js/app-state.test.js tools/time/js/import-utils.test.js tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.test.js tools/time/js/notification-model.test.js tools/time/js/notification.test.js tools/time/js/notification-integration.test.js tools/time/js/service-worker-notification.test.js
$NODE --check tools/time/js/date-utils.js
$NODE --check tools/time/js/app-state.js
$NODE --check tools/time/js/db.js
$NODE --check tools/time/js/notification-crypto.js
$NODE --check tools/time/js/notification-model.js
$NODE --check tools/time/js/notification-sync.js
$NODE --check tools/time/js/notification.js
$NODE --check tools/time/js/app.js
$NODE --check tools/time/sw.js
cd workers/notifications
$PNPM test
$PNPM check
```

Expected: zero failures, zero syntax errors, successful Worker dry-run.

- [ ] **Step 3: Run local browser verification**

Start a new static-server port and Wrangler local Worker, then verify permission flow, stable device ID, encrypted test push payload, local CRUD during API failure, queue recovery, concise copy, and click targeting. Use a fresh browser context and confirm no task title appears in network request plaintext.

- [ ] **Step 4: Prepare Cloudflare resources**

From `workers/notifications` run the authenticated commands:

```bash
$PNPM exec wrangler d1 create billnest_notifications --binding NOTIFICATIONS_DB --update-config wrangler.jsonc
$PNPM exec wrangler d1 migrations apply NOTIFICATIONS_DB --remote
$PNPM exec wrangler secret put VAPID_PUBLIC_KEY
$PNPM exec wrangler secret put VAPID_PRIVATE_KEY
$PNPM exec wrangler secret put VAPID_SUBJECT
```

Enter the real values interactively. Generate the VAPID key pair once with a trusted local command and never commit the private key. Review the resulting account-specific D1 ID before committing `wrangler.jsonc`.

- [ ] **Step 5: Deploy and perform real-device verification only with configured credentials**

```bash
$PNPM exec wrangler deploy
```

Verify `GET https://billnest.top/api/notifications/config`, then test one iOS/iPadOS Home Screen PWA, one Android Chromium PWA, and one desktop Chromium install. Record unsupported platforms as explicit UI states rather than failures. If Cloudflare credentials or physical devices are unavailable, report these checks as outstanding and do not claim production background delivery is verified.

- [ ] **Step 6: Commit docs and deployment configuration**

```bash
git add tools/time/README.md tools/time/CHANGELOG.md workers/README.md workers/notifications/wrangler.jsonc docs/superpowers/specs/2026-07-11-time-web-push-backend-design.md
git commit -m "docs(time): document encrypted background reminders"
```

---

## Completion Gate

Before declaring completion:

- Confirm every task's RED test failed for the intended missing behavior before implementation.
- Confirm the full test command is green after all edits.
- Inspect browser network payloads and prove notification title/body are ciphertext.
- Confirm task CRUD still works with `/api/notifications` unavailable.
- Confirm no secrets, device tokens, PushSubscription endpoints, or notification plaintext appear in git diff or logs.
- Separate local implementation success from production Cloudflare and physical-device verification.
