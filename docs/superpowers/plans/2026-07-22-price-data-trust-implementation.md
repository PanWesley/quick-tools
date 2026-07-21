# 买前省省数据可信与体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留短链解析与匿名共享价格历史，同时实现最小化上传、双重限流、去重、防污染、可信文案、PWA 缓存修复与基础可访问性优化。

**Architecture:** Worker 继续以 Cloudflare KV 保存商品与历史，新增原生 Rate Limiting bindings 保护匿名客户端和商品维度的写入。前端把远程接口封装为可测试的 UMD 模块，本地记价优先，远程共享失败仅展示同步状态；短链解析仍可接收完整分享文本，但不持久化原文。

**Tech Stack:** 原生 JavaScript、Node.js `node:test`、Cloudflare Workers、Workers KV、Workers Rate Limiting API、IndexedDB、Service Worker。

## Global Constraints

- 不引入账号、登录、Durable Object、第三方运行时依赖或自动降价通知。
- 用户备注、关注目标价、导入导出内容只保存在本地。
- Worker 不保存分享文本和原始短链，只保存平台、商品 ID、有限标题、价格与服务器时间。
- 保留并整合当前工作区中 `workers/price` 的未提交改动，不覆盖用户修改。
- 所有行为改动遵循测试先行；配置和纯文案改动执行静态检查与浏览器验证。

---

### Task 1: Worker 核心校验与 CORS 策略

**Files:**
- Modify: `workers/price/core.test.mjs`
- Modify: `workers/price/core.mjs`

**Interfaces:**
- Consumes: `Request.url`、`Origin` 请求头和 `env.ALLOWED_ORIGINS`。
- Produces: `allowedOrigin(request, env)`、`isValidPrice(price)`、`normalizeTitle(title)`、`medianPrice(snapshots)`、`isSuspiciousPrice(price, snapshots)`。

- [ ] **Step 1: 写入失败测试**

在 `core.test.mjs` 增加：缺少白名单时拒绝、显式 `*` 开放、无 `Origin` 时使用请求 URL、价格必须大于零、标题空白规范化和截断、中位数与 0.25–4 倍异常边界测试。

```js
test('allowedOrigin fails closed without configuration', () => {
  const request = new Request('https://billnest.top/api/price/config');
  assert.equal(allowedOrigin(request, {}), null);
});

test('allowedOrigin supports explicit wildcard configuration', () => {
  const request = new Request('https://billnest.top/api/price/config', {
    headers: { Origin: 'https://example.com' }
  });
  assert.equal(allowedOrigin(request, { ALLOWED_ORIGINS: '*' }), '*');
});

test('allowedOrigin uses request URL for same-origin requests without Origin', () => {
  const request = new Request('https://billnest.top/api/price/config');
  assert.equal(allowedOrigin(request, mockEnv), 'https://billnest.top');
});

test('isSuspiciousPrice rejects extreme outliers after five snapshots', () => {
  const snapshots = [90, 95, 100, 105, 110].map((finalPrice) => ({ finalPrice }));
  assert.equal(isSuspiciousPrice(24, snapshots), true);
  assert.equal(isSuspiciousPrice(401, snapshots), true);
  assert.equal(isSuspiciousPrice(25, snapshots), false);
  assert.equal(isSuspiciousPrice(400, snapshots), false);
});
```

- [ ] **Step 2: 验证测试按预期失败**

Run: `node --disable-warning=ExperimentalWarning --test core.test.mjs`

Expected: FAIL，原因是通配符行为不正确、零价格仍有效，以及新 helper 尚未导出。

- [ ] **Step 3: 实现最小核心逻辑**

`allowedOrigin` 对缺失配置返回 `null`；显式通配符返回 `*`；无 `Origin` 时解析 `request.url`。`isValidPrice` 改为 `price > 0`。新增标题规范化、中位数和异常价格 helper，并将 CORS 允许请求头扩展为 `Content-Type, X-Price-Client-ID`。

- [ ] **Step 4: 验证核心测试通过**

Run: `node --disable-warning=ExperimentalWarning --test core.test.mjs`

Expected: PASS，全部核心测试为绿色。

- [ ] **Step 5: 提交核心逻辑**

```bash
git add workers/price/core.mjs workers/price/core.test.mjs
git commit -m "fix(price): harden worker validation and cors"
```

---

### Task 2: 快照限流、去重、防污染与短链读取限制

**Files:**
- Modify: `workers/price/app.mjs`
- Create: `workers/price/app.test.mjs`
- Modify: `workers/price/worker.mjs`
- Modify: `workers/price/wrangler.jsonc`

**Interfaces:**
- Consumes: `createPriceApp({ kv, fetchImpl, now })`，以及 `env.SNAPSHOT_CLIENT_LIMITER`、`env.SNAPSHOT_ITEM_LIMITER`。
- Produces: `/resolve`、`/snapshot`、`/history`、`/config` 的稳定 JSON 行为；重复写入返回 `deduplicated: true`。

- [ ] **Step 1: 写快照治理失败测试**

在 `app.test.mjs` 建立内存 KV 与限流器，覆盖：缺客户端 ID、binding 缺失、客户端限流、商品限流、拒绝 `note`/`capturedAt`、服务器生成时间、10 分钟相同价格去重、异常价格 422、最多一年和 500 条。

```js
test('snapshot stores only minimal server-owned data', async () => {
  const app = createPriceApp({
    kv: createMemoryKv(),
    now: () => new Date('2026-07-22T00:00:00.000Z')
  });
  const response = await app.fetch(snapshotRequest({
    platform: 'jd', itemId: '123', finalPrice: 99, title: '  商品   标题  '
  }), rateLimitEnv());
  assert.equal(response.status, 200);
  const history = await readHistory(app, 'jd', '123', rateLimitEnv());
  assert.deepEqual(history.snapshots[0], {
    finalPrice: 99,
    listPrice: 99,
    promoPrice: null,
    couponPrice: null,
    stockStatus: 'unknown',
    capturedAt: '2026-07-22T00:00:00.000Z'
  });
});
```

- [ ] **Step 2: 验证治理测试失败**

Run: `node --disable-warning=ExperimentalWarning --test app.test.mjs`

Expected: FAIL，因为当前应用不注入时钟、没有限流、仍接受备注与客户端时间、没有去重和异常判断。

- [ ] **Step 3: 实现快照治理**

为 `createPriceApp` 注入 `fetchImpl = fetch` 与 `now = () => new Date()`。快照路由依次执行严格字段校验、匿名客户端 ID 校验、两个 limiter、已有历史读取、10 分钟去重、异常价格判断和写入。repository 保留一年并截取最新 500 条，写入失败返回明确 503，而不是伪装成功。

- [ ] **Step 4: 写短链安全失败测试**

覆盖 `GET` 方法、`new URL` 相对跳转、256 KiB 上限、响应体读取仍受 8 秒超时，以及未知跳转主机不继续请求。

- [ ] **Step 5: 验证短链测试失败**

Run: `node --disable-warning=ExperimentalWarning --test app.test.mjs --test-name-pattern="short link"`

Expected: FAIL，因为当前代码直接 `response.text()`，且提前清除超时。

- [ ] **Step 6: 实现有界 HTML 读取与安全跳转**

新增最多读取 256 KiB 的 stream helper；超限时取消 reader 并返回 `response_too_large`。跳转地址统一通过 `new URL(target, currentUrl)`，在完成当前响应处理后才清除 timeout。

- [ ] **Step 7: 配置 Rate Limiting bindings**

在 `wrangler.jsonc` 增加：

```jsonc
"ratelimits": [
  {
    "name": "SNAPSHOT_CLIENT_LIMITER",
    "namespace_id": "21001",
    "simple": { "limit": 12, "period": 60 }
  },
  {
    "name": "SNAPSHOT_ITEM_LIMITER",
    "namespace_id": "21002",
    "simple": { "limit": 30, "period": 60 }
  }
]
```

`worker.mjs` 将两个 bindings 传给应用使用；本地测试使用显式 mock。

- [ ] **Step 8: 验证所有 Worker 测试**

Run: `node --disable-warning=ExperimentalWarning --test *.test.mjs`

Expected: PASS，无失败测试。

- [ ] **Step 9: 提交 Worker 治理**

```bash
git add workers/price/app.mjs workers/price/app.test.mjs workers/price/worker.mjs workers/price/wrangler.jsonc
git commit -m "feat(price): protect shared price history"
```

---

### Task 3: 可测试的前端价格 API 与本地优先同步状态

**Files:**
- Create: `tools/price/js/price-api.js`
- Create: `tools/price/js/price-api.test.js`
- Modify: `tools/price/js/app.js`
- Modify: `tools/price/index.html`

**Interfaces:**
- Consumes: `window.ZhenjiaPriceApi.create({ baseUrl, fetchImpl, storage, cryptoImpl })`。
- Produces: `init()`、`resolve(input)`、`getHistory(platform, itemId)`、`recordSnapshot(data)`；`recordSnapshot` 自动加入匿名 ID 且只发送允许字段。

- [ ] **Step 1: 写前端 API 失败测试**

覆盖随机客户端 ID 只生成一次、请求头包含 ID、请求体移除 `note`/`capturedAt`、错误响应保留 `code`/`retryable`、重复响应正常返回。

```js
test('recordSnapshot sends minimal payload without local note', async () => {
  const calls = [];
  const api = createPriceApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ deduplicated: false });
    },
    storage: memoryStorage(),
    cryptoImpl: { randomUUID: () => 'client-12345678' }
  });
  await api.recordSnapshot({
    platform: 'jd', itemId: '123', finalPrice: 99,
    title: '商品', note: '直播间', capturedAt: 'fake-time'
  });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.note, undefined);
  assert.equal(body.capturedAt, undefined);
  assert.equal(calls[0].options.headers['X-Price-Client-ID'], 'client-12345678');
});
```

- [ ] **Step 2: 验证前端 API 测试失败**

Run: `node --test tools/price/js/price-api.test.js`

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 实现 UMD API 模块**

抽取 `app.js` 顶部的 `priceApi`，使用允许字段白名单构建 body。匿名 ID 保存到 `price-anonymous-client-id`；没有 `crypto.randomUUID` 时使用 `crypto.getRandomValues` 生成随机十六进制 ID。网络失败返回结构化可重试错误。

- [ ] **Step 4: 接入本地优先同步提示**

`app.js` 继续先写 IndexedDB，再调用远程接口。分析页新增 `snapshot-sync-message` 状态：成功显示“已保存到本地并匿名贡献到共享历史”，去重显示“已保存到本地；共享历史已有相同价格”，失败显示“已保存到本地，暂未同步共享历史”。不得把本地备注传给 API。

- [ ] **Step 5: 验证前端 API 与现有测试**

Run: `node --test tools/price/js/price-api.test.js tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js`

Expected: PASS，所有前端测试为绿色。

- [ ] **Step 6: 提交前端 API**

```bash
git add tools/price/js/price-api.js tools/price/js/price-api.test.js tools/price/js/app.js tools/price/index.html
git commit -m "feat(price): minimize anonymous snapshot uploads"
```

---

### Task 4: 可信文案、空状态与可访问性

**Files:**
- Modify: `tools/price/README.md`
- Modify: `tools/price/CHANGELOG.md`
- Modify: `tools/price/index.html`
- Modify: `tools/price/js/app.js`
- Modify: `tools/price/css/style.css`

**Interfaces:**
- Consumes: 已确认的数据边界与非目标。
- Produces: 明确的隐私说明、诚实的功能承诺、键盘可操作的好物卡片与有效区域标题。

- [ ] **Step 1: 更新设置页与 README**

设置页把“纯前端实现”替换为“本地优先”，新增三条隐私说明：短链原文只用于当次解析、主动记价会匿名贡献最小字段、备注与心愿价不上云。README 同步 Worker 能力、数据边界、限流和非目标。

- [ ] **Step 2: 修正功能承诺**

心愿价说明改为“保存在关注列表，方便以后回来比较；当前版本不提供自动降价通知”，按钮改为“保存心愿价”。好物页增加“以下均为示例数据，不代表实时价格或优惠”。

- [ ] **Step 3: 优化空状态与语义**

关注空状态增加 `data-view-link="home"` 的“去查价”按钮。好物卡片改成 `<button type="button" class="pick-card">`，CSS 增加 `appearance: none; text-align: left; color: inherit; width: 100%`。为 `watches-title`、`picks-title`、`profile-title` 添加视觉隐藏标题。

- [ ] **Step 4: 补充键盘焦点样式**

为 `.theme-options input:focus-visible + span` 和 `.palette-options label:has(input:focus-visible)` 增加清晰 outline；保留全局按钮焦点样式。

- [ ] **Step 5: 更新变更日志并执行静态检查**

Run: `node --check tools/price/js/app.js && node --check tools/price/js/price-api.js && git diff --check`

Expected: exit 0，无语法或空白错误。

- [ ] **Step 6: 提交体验与文案**

```bash
git add tools/price/README.md tools/price/CHANGELOG.md tools/price/index.html tools/price/js/app.js tools/price/css/style.css
git commit -m "fix(price): clarify privacy and feature boundaries"
```

---

### Task 5: PWA 缓存一致性与最终验证

**Files:**
- Modify: `tools/price/index.html`
- Modify: `tools/price/sw.js`

**Interfaces:**
- Consumes: 最终前端资源集合。
- Produces: `zhenjia-assistant-v3` 精确版本缓存和离线页面回退。

- [ ] **Step 1: 写 Service Worker 静态契约测试**

在 `tools/price/js/price-api.test.js` 旁新增或扩展测试，读取 `index.html` 与 `sw.js`，断言二者资源版本均为 `v=103`、缓存名为 v3、`caches.match` 不含 `ignoreSearch: true`，并包含 `price-api.js`。

- [ ] **Step 2: 验证缓存契约测试失败**

Run: `node --test tools/price/js/price-api.test.js`

Expected: FAIL，因为现有 HTML 为 v102，Service Worker 为 v100，缓存名为 v2。

- [ ] **Step 3: 更新资源版本与缓存策略**

将价格工具 CSS/JS 统一为 `v=103`，缓存名升级到 `zhenjia-assistant-v3`，APP_SHELL 加入 `price-api.js?v=103`。删除 `ignoreSearch: true`，导航请求网络失败时回退缓存的 `/tools/price/index.html`。

- [ ] **Step 4: 运行完整自动化验证**

Run:

```bash
node --test tools/price/js/*.test.js
node --disable-warning=ExperimentalWarning --test workers/price/*.test.mjs
for file in tools/price/js/*.js tools/price/sw.js workers/price/*.mjs; do node --check "$file"; done
git diff --check
```

Expected: 所有测试通过，所有语法检查与 diff 检查 exit 0。

- [ ] **Step 5: 执行 Worker dry-run**

Run: `cd workers/price && ./node_modules/.bin/wrangler deploy --dry-run`

Expected: 成功打包并列出 KV、两个 Rate Limiting bindings 与 `ALLOWED_ORIGINS`。若本机 Wrangler 日志目录权限受限，记录该环境限制，并以打包与 binding 输出作为配置验证证据。

- [ ] **Step 6: 浏览器验证**

在 390×844 视口检查首页、示例分析、关注空状态、好物和设置页；确认浅色/深色布局、底部导航、焦点样式、隐私说明与本地同步提示。保存关键截图到当前可写的可视化目录。

- [ ] **Step 7: 提交 PWA 修复**

```bash
git add tools/price/index.html tools/price/sw.js tools/price/js/price-api.test.js
git commit -m "fix(price): refresh versioned pwa cache"
```
