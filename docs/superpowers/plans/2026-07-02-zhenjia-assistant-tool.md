# Zhenjia Assistant Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `tools/price/` static PWA for “真价助手” with link parsing, local price history, trustworthy low-price judgement, watch targets, JSON import/export, and Quick Tools integration.

**Architecture:** Use the existing static-tool pattern: plain HTML/CSS/JavaScript, isolated manifest/service worker, IndexedDB for user data, and small pure modules tested with `node:test`. The first release is local-first and explicit about boundaries: real crawling, coupons, CPS links, and outbound notifications are future states, not active features.

**Tech Stack:** HTML, CSS, browser JavaScript, IndexedDB, Service Worker, Canvas/SVG charting without third-party chart libraries, Node built-in `node:test` for pure utility tests.

---

## File Structure

- Create `tools/price/index.html`: app shell with four views: home, analysis, watches, data.
- Create `tools/price/css/style.css`: mobile-first “可信查价工具” visual system, dark/light theme using `quick-tools-theme`, responsive layout.
- Create `tools/price/js/link-parser.js`: platform and product-id parser for JD, Taobao, Tmall, and PDD links/share text.
- Create `tools/price/js/price-judge.js`: percentile, score, level, reason, and suggestion calculations.
- Create `tools/price/js/export.js`: export payload shaping and import validation.
- Create `tools/price/js/sample-data.js`: 3-5 sample products and snapshots for the no-API demo flow.
- Create `tools/price/js/db.js`: IndexedDB stores and CRUD with local OpLog writes.
- Create `tools/price/js/chart.js`: lightweight SVG or Canvas line chart for price history.
- Create `tools/price/js/app.js`: view state, render pipeline, form handlers, data import/export, SW registration.
- Create `tools/price/js/link-parser.test.js`: Node tests for supported/unsupported link parsing.
- Create `tools/price/js/price-judge.test.js`: Node tests for level and score behavior.
- Create `tools/price/js/export.test.js`: Node tests for export/import payload behavior.
- Create `tools/price/manifest.json`: standalone PWA metadata.
- Create `tools/price/sw.js`: cache-first app shell service worker with `ignoreSearch: true` fallback.
- Create `tools/price/README.md`: scope, local storage, boundaries, verification commands.
- Modify `index.html`: add a 真价助手 tool card and icon style.
- Modify `manifest.json`: add a 真价助手 shortcut.
- Modify `sw.js`: include `/tools/price/` in root shell cache.
- Modify `vercel.json`: add cache headers and rewrites for `/tools/price`.

## Tasks

### Task 1: Pure Utility Tests and Modules

**Files:**
- Create: `tools/price/js/link-parser.test.js`
- Create: `tools/price/js/price-judge.test.js`
- Create: `tools/price/js/export.test.js`
- Create: `tools/price/js/link-parser.js`
- Create: `tools/price/js/price-judge.js`
- Create: `tools/price/js/export.js`

- [ ] **Step 1: Write failing link parser tests**

Create `tools/price/js/link-parser.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseProductInput,
  normalizePlatformLabel
} = require('./link-parser.js');

test('parseProductInput extracts a JD sku from a product page URL', () => {
  const result = parseProductInput('https://item.jd.com/100012043978.html?utm_source=test');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'jd');
  assert.equal(result.data.itemId, '100012043978');
  assert.equal(result.data.skuId, '100012043978');
  assert.equal(result.data.canonicalUrl, 'https://item.jd.com/100012043978.html');
});

test('parseProductInput extracts a Taobao item id from share text', () => {
  const result = parseProductInput('看看这个 https://item.taobao.com/item.htm?id=726477321880&spm=a21 复制打开');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'taobao');
  assert.equal(result.data.itemId, '726477321880');
  assert.equal(result.data.canonicalUrl, 'https://item.taobao.com/item.htm?id=726477321880');
});

test('parseProductInput extracts a Tmall item id', () => {
  const result = parseProductInput('https://detail.tmall.com/item.htm?id=645112233445&abbucket=1');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'tmall');
  assert.equal(result.data.itemId, '645112233445');
  assert.equal(result.data.canonicalUrl, 'https://detail.tmall.com/item.htm?id=645112233445');
});

test('parseProductInput extracts a PDD goods id', () => {
  const result = parseProductInput('https://mobile.yangkeduo.com/goods.html?goods_id=531222333444');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'pdd');
  assert.equal(result.data.itemId, '531222333444');
  assert.equal(result.data.canonicalUrl, 'https://mobile.yangkeduo.com/goods.html?goods_id=531222333444');
});

test('parseProductInput rejects short links with a specific error', () => {
  const result = parseProductInput('https://m.tb.cn/h.abc123');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'short_link_unsupported');
});

test('parseProductInput rejects unsupported platforms', () => {
  const result = parseProductInput('https://example.com/item/123');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unsupported_platform');
});

test('normalizePlatformLabel returns Chinese display labels', () => {
  assert.equal(normalizePlatformLabel('jd'), '京东');
  assert.equal(normalizePlatformLabel('taobao'), '淘宝');
  assert.equal(normalizePlatformLabel('tmall'), '天猫');
  assert.equal(normalizePlatformLabel('pdd'), '拼多多');
  assert.equal(normalizePlatformLabel('unknown'), '未知平台');
});
```

- [ ] **Step 2: Write failing price judge tests**

Create `tools/price/js/price-judge.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePercentile,
  judgePrice,
  summarizeSnapshots
} = require('./price-judge.js');

function snapshot(daysAgo, finalPrice) {
  const date = new Date(Date.UTC(2026, 6, 2 - daysAgo, 10, 0, 0));
  return {
    id: `snap_${daysAgo}_${finalPrice}`,
    productId: 'product_1',
    capturedAt: date.toISOString(),
    finalPrice,
    listPrice: finalPrice,
    promoPrice: finalPrice,
    couponPrice: finalPrice,
    stockStatus: 'in_stock',
    source: 'manual'
  };
}

test('calculatePercentile interpolates sorted numeric values', () => {
  assert.equal(calculatePercentile([100, 200, 300, 400, 500], 20), 180);
  assert.equal(calculatePercentile([100, 200, 300, 400, 500], 70), 380);
});

test('summarizeSnapshots reports min prices and snapshot count', () => {
  const snapshots = [
    snapshot(1, 120),
    snapshot(5, 100),
    snapshot(35, 90),
    snapshot(95, 80)
  ];
  const summary = summarizeSnapshots(snapshots, '2026-07-02T12:00:00.000Z');
  assert.equal(summary.snapshotCount, 4);
  assert.equal(summary.historyMinPrice, 80);
  assert.equal(summary.minPrice30d, 100);
  assert.equal(summary.minPrice90d, 90);
});

test('judgePrice returns insufficient when fewer than five snapshots exist', () => {
  const result = judgePrice({
    currentFinalPrice: 99,
    snapshots: [snapshot(1, 100), snapshot(2, 101), snapshot(3, 102), snapshot(4, 103)],
    nowIso: '2026-07-02T12:00:00.000Z'
  });
  assert.equal(result.level, 'insufficient');
  assert.equal(result.title, '数据不足');
  assert.ok(result.reasons.includes('价格记录少于 5 条'));
});

test('judgePrice identifies history low', () => {
  const result = judgePrice({
    currentFinalPrice: 79,
    snapshots: [120, 110, 105, 99, 88].map((price, index) => snapshot(index + 1, price)),
    nowIso: '2026-07-02T12:00:00.000Z'
  });
  assert.equal(result.level, 'history_low');
  assert.equal(result.title, '历史低价');
  assert.ok(result.score >= 90);
});

test('judgePrice identifies recent low and expensive ranges', () => {
  const base = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170].map((price, index) => snapshot(index + 1, price));
  assert.equal(judgePrice({ currentFinalPrice: 95, snapshots: base, nowIso: '2026-07-02T12:00:00.000Z' }).level, 'recent_low');
  assert.equal(judgePrice({ currentFinalPrice: 155, snapshots: base, nowIso: '2026-07-02T12:00:00.000Z' }).level, 'expensive');
});
```

- [ ] **Step 3: Write failing export tests**

Create `tools/price/js/export.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildExportPayload,
  validateImportPayload
} = require('./export.js');

test('buildExportPayload includes all stores and metadata', () => {
  const payload = buildExportPayload({
    products: [{ id: 'product_1', platform: 'jd', itemId: '100' }],
    priceSnapshots: [{ id: 'snap_1', productId: 'product_1', finalPrice: 99 }],
    watches: [{ id: 'watch_1', productId: 'product_1', targetPrice: 88 }],
    opLogs: [{ id: 'op_1', entityType: 'product' }]
  }, '2026-07-02T00:00:00.000Z');

  assert.equal(payload.app, 'zhenjia-assistant');
  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, '2026-07-02T00:00:00.000Z');
  assert.equal(payload.products.length, 1);
  assert.equal(payload.priceSnapshots.length, 1);
  assert.equal(payload.watches.length, 1);
  assert.equal(payload.opLogs.length, 1);
});

test('validateImportPayload accepts a valid payload', () => {
  const result = validateImportPayload({
    app: 'zhenjia-assistant',
    version: 1,
    exportedAt: '2026-07-02T00:00:00.000Z',
    products: [],
    priceSnapshots: [],
    watches: [],
    opLogs: []
  });
  assert.equal(result.ok, true);
});

test('validateImportPayload rejects payloads from another app', () => {
  const result = validateImportPayload({ app: 'other-app', version: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_app');
});

test('validateImportPayload rejects missing arrays', () => {
  const result = validateImportPayload({ app: 'zhenjia-assistant', version: 1, products: [] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_shape');
});
```

- [ ] **Step 4: Run tests and verify red**

Run:

```powershell
node --test tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js
```

Expected: fail with module-not-found errors for `link-parser.js`, `price-judge.js`, and `export.js`.

- [ ] **Step 5: Implement `link-parser.js`**

Create `tools/price/js/link-parser.js` with a UMD-style browser/CommonJS wrapper and these exported functions:

```js
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaLinkParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var SHORT_LINK_HOSTS = ['m.tb.cn', 's.click.taobao.com', 'u.jd.com', '3.cn', 'p.pinduoduo.com'];

  function extractFirstUrl(input) {
    var text = String(input || '').trim();
    var match = text.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0].replace(/[，。；、]+$/, '') : '';
  }

  function normalizePlatformLabel(platform) {
    return {
      jd: '京东',
      taobao: '淘宝',
      tmall: '天猫',
      pdd: '拼多多'
    }[platform] || '未知平台';
  }

  function cleanUrl(url) {
    var parsed = new URL(url);
    parsed.hash = '';
    return parsed;
  }

  function isShortLink(hostname) {
    return SHORT_LINK_HOSTS.some(function(host) {
      return hostname === host || hostname.endsWith('.' + host);
    });
  }

  function ok(data) {
    return { ok: true, data: data };
  }

  function fail(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  function parseJd(parsed, rawUrl) {
    var pathMatch = parsed.pathname.match(/\/(\d+)\.html$/);
    var sku = pathMatch ? pathMatch[1] : parsed.searchParams.get('sku') || parsed.searchParams.get('skuId');
    if (!sku) return fail('parse_failed', '没有识别到京东商品 ID。');
    return ok({
      platform: 'jd',
      itemId: sku,
      skuId: sku,
      shopId: '',
      rawUrl: rawUrl,
      canonicalUrl: 'https://item.jd.com/' + sku + '.html'
    });
  }

  function parseTaobaoLike(parsed, rawUrl, platform) {
    var id = parsed.searchParams.get('id') || parsed.searchParams.get('itemId');
    if (!id) return fail('parse_failed', '没有识别到商品 ID。');
    var host = platform === 'tmall' ? 'detail.tmall.com' : 'item.taobao.com';
    return ok({
      platform: platform,
      itemId: id,
      skuId: parsed.searchParams.get('skuId') || '',
      shopId: parsed.searchParams.get('shop_id') || '',
      rawUrl: rawUrl,
      canonicalUrl: 'https://' + host + '/item.htm?id=' + encodeURIComponent(id)
    });
  }

  function parsePdd(parsed, rawUrl) {
    var id = parsed.searchParams.get('goods_id') || parsed.searchParams.get('goodsId');
    if (!id) return fail('parse_failed', '没有识别到拼多多商品 ID。');
    return ok({
      platform: 'pdd',
      itemId: id,
      skuId: parsed.searchParams.get('sku_id') || '',
      shopId: '',
      rawUrl: rawUrl,
      canonicalUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=' + encodeURIComponent(id)
    });
  }

  function parseProductInput(input) {
    var rawUrl = extractFirstUrl(input);
    if (!rawUrl) return fail('missing_url', '没有识别到商品链接。');

    var parsed;
    try {
      parsed = cleanUrl(rawUrl);
    } catch (error) {
      return fail('invalid_url', '链接格式无效。');
    }

    var hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (isShortLink(hostname)) {
      return fail('short_link_unsupported', '首版无法展开短链接，请复制完整商品详情页链接。');
    }
    if (hostname === 'item.jd.com' || hostname.endsWith('.jd.com')) return parseJd(parsed, rawUrl);
    if (hostname === 'item.taobao.com' || hostname.endsWith('.taobao.com')) return parseTaobaoLike(parsed, rawUrl, 'taobao');
    if (hostname === 'detail.tmall.com' || hostname.endsWith('.tmall.com')) return parseTaobaoLike(parsed, rawUrl, 'tmall');
    if (hostname === 'mobile.yangkeduo.com' || hostname === 'yangkeduo.com' || hostname.endsWith('.yangkeduo.com')) return parsePdd(parsed, rawUrl);
    return fail('unsupported_platform', '暂不支持该平台链接。');
  }

  return {
    extractFirstUrl: extractFirstUrl,
    normalizePlatformLabel: normalizePlatformLabel,
    parseProductInput: parseProductInput
  };
});
```

- [ ] **Step 6: Implement `price-judge.js`**

Create `tools/price/js/price-judge.js` with these exported functions:

```js
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaPriceJudge = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  function toNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function pricesFromSnapshots(snapshots) {
    return (snapshots || []).map(function(snapshot) {
      return toNumber(snapshot.finalPrice);
    }).filter(function(price) {
      return price > 0;
    }).sort(function(a, b) {
      return a - b;
    });
  }

  function calculatePercentile(values, percentile) {
    var sorted = values.slice().filter(function(value) {
      return Number.isFinite(Number(value));
    }).map(Number).sort(function(a, b) { return a - b; });
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    var rank = (percentile / 100) * (sorted.length - 1);
    var lower = Math.floor(rank);
    var upper = Math.ceil(rank);
    var weight = rank - lower;
    return Math.round((sorted[lower] + (sorted[upper] - sorted[lower]) * weight) * 100) / 100;
  }

  function isWithinDays(snapshot, now, days) {
    var captured = new Date(snapshot.capturedAt);
    if (Number.isNaN(captured.getTime())) return false;
    return now.getTime() - captured.getTime() <= days * 24 * 60 * 60 * 1000;
  }

  function minPrice(snapshots) {
    var prices = pricesFromSnapshots(snapshots);
    return prices.length ? prices[0] : 0;
  }

  function summarizeSnapshots(snapshots, nowIso) {
    var list = snapshots || [];
    var now = nowIso ? new Date(nowIso) : new Date();
    var prices90d = pricesFromSnapshots(list.filter(function(snapshot) { return isWithinDays(snapshot, now, 90); }));
    return {
      snapshotCount: list.length,
      historyMinPrice: minPrice(list),
      minPrice30d: minPrice(list.filter(function(snapshot) { return isWithinDays(snapshot, now, 30); })),
      minPrice90d: prices90d.length ? prices90d[0] : 0,
      p20Price90d: calculatePercentile(prices90d, 20),
      p70Price90d: calculatePercentile(prices90d, 70)
    };
  }

  function clamp(number, min, max) {
    return Math.max(min, Math.min(max, number));
  }

  function buildResult(level, title, score, suggestion, reasons, summary) {
    return {
      level: level,
      title: title,
      score: clamp(Math.round(score), 0, 100),
      suggestion: suggestion,
      reasons: reasons,
      summary: summary
    };
  }

  function judgePrice(input) {
    var current = toNumber(input && input.currentFinalPrice);
    var snapshots = (input && input.snapshots) || [];
    var summary = summarizeSnapshots(snapshots, input && input.nowIso);

    if (summary.snapshotCount < 5 || current <= 0) {
      return buildResult('insufficient', '数据不足', 45, '先记录几次价格，再判断是否值得买。', ['价格记录少于 5 条'], summary);
    }
    if (current <= summary.historyMinPrice) {
      return buildResult('history_low', '历史低价', 94, '当前价不高于已记录历史最低价，刚需可以购买。', ['当前价不高于历史最低价', '已有足够本地价格记录'], summary);
    }
    if (summary.p20Price90d && current <= summary.p20Price90d) {
      return buildResult('recent_low', '近期低价', 82, '当前价低于近 90 天大多数记录，刚需可以购买。', ['当前价低于近 90 天 P20 分位', '可设置更低目标价继续观察'], summary);
    }
    if (summary.p70Price90d && current <= summary.p70Price90d) {
      return buildResult('normal', '价格一般', 66, '当前价处于常见区间，刚需可买，不急可以等等。', ['当前价位于近 90 天 P20 到 P70 区间'], summary);
    }
    return buildResult('expensive', '偏贵', 38, '当前价高于近 90 天多数记录，建议先关注目标价。', ['当前价高于近 90 天 P70 分位'], summary);
  }

  return {
    calculatePercentile: calculatePercentile,
    summarizeSnapshots: summarizeSnapshots,
    judgePrice: judgePrice
  };
});
```

- [ ] **Step 7: Implement `export.js`**

Create `tools/price/js/export.js`:

```js
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaExport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var APP_ID = 'zhenjia-assistant';
  var VERSION = 1;
  var REQUIRED_ARRAYS = ['products', 'priceSnapshots', 'watches', 'opLogs'];

  function buildExportPayload(data, exportedAt) {
    return {
      app: APP_ID,
      version: VERSION,
      exportedAt: exportedAt || new Date().toISOString(),
      products: Array.isArray(data.products) ? data.products : [],
      priceSnapshots: Array.isArray(data.priceSnapshots) ? data.priceSnapshots : [],
      watches: Array.isArray(data.watches) ? data.watches : [],
      opLogs: Array.isArray(data.opLogs) ? data.opLogs : []
    };
  }

  function validateImportPayload(payload) {
    if (!payload || payload.app !== APP_ID) {
      return { ok: false, error: { code: 'invalid_app', message: '文件不是由真价助手导出的。' } };
    }
    if (payload.version !== VERSION) {
      return { ok: false, error: { code: 'invalid_version', message: '导出文件版本不兼容。' } };
    }
    var missing = REQUIRED_ARRAYS.find(function(key) {
      return !Array.isArray(payload[key]);
    });
    if (missing) {
      return { ok: false, error: { code: 'invalid_shape', message: '导出文件缺少必要数据表。' } };
    }
    return { ok: true, data: payload };
  }

  return {
    APP_ID: APP_ID,
    VERSION: VERSION,
    buildExportPayload: buildExportPayload,
    validateImportPayload: validateImportPayload
  };
});
```

- [ ] **Step 8: Run tests and verify green**

Run:

```powershell
node --test tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit pure utility modules**

Run:

```powershell
git add tools/price/js/link-parser.js tools/price/js/price-judge.js tools/price/js/export.js tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js
git commit -m "feat(price): add parsing and judgement utilities"
```

### Task 2: Sample Data, IndexedDB, and Chart Module

**Files:**
- Create: `tools/price/js/sample-data.js`
- Create: `tools/price/js/db.js`
- Create: `tools/price/js/chart.js`

- [ ] **Step 1: Create sample data module**

Create `tools/price/js/sample-data.js` with browser global `ZhenjiaSampleData`:

```js
(function(root, factory) {
  root.ZhenjiaSampleData = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  function daysAgo(days, hour) {
    var date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(hour || 10, 0, 0, 0);
    return date.toISOString();
  }

  var products = [
    {
      id: 'sample_keyboard',
      platform: 'jd',
      itemId: '100012043978',
      skuId: '100012043978',
      shopId: '',
      title: '示例：机械键盘 87 键无线版',
      shopName: '示例数码旗舰店',
      imageUrl: '',
      rawUrl: 'https://item.jd.com/100012043978.html',
      canonicalUrl: 'https://item.jd.com/100012043978.html',
      source: 'sample',
      createdAt: daysAgo(100),
      updatedAt: daysAgo(0)
    },
    {
      id: 'sample_monitor',
      platform: 'tmall',
      itemId: '645112233445',
      skuId: '',
      shopId: '',
      title: '示例：27 英寸 4K 显示器',
      shopName: '示例办公装备店',
      imageUrl: '',
      rawUrl: 'https://detail.tmall.com/item.htm?id=645112233445',
      canonicalUrl: 'https://detail.tmall.com/item.htm?id=645112233445',
      source: 'sample',
      createdAt: daysAgo(100),
      updatedAt: daysAgo(0)
    },
    {
      id: 'sample_tissue',
      platform: 'pdd',
      itemId: '531222333444',
      skuId: '',
      shopId: '',
      title: '示例：家庭抽纸囤货装',
      shopName: '示例日用品店',
      imageUrl: '',
      rawUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=531222333444',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=531222333444',
      source: 'sample',
      createdAt: daysAgo(100),
      updatedAt: daysAgo(0)
    }
  ];

  var priceSeries = {
    sample_keyboard: [599, 579, 549, 529, 519, 499, 539, 509, 489, 469],
    sample_monitor: [1899, 1799, 1699, 1749, 1599, 1549, 1499, 1529, 1469, 1399],
    sample_tissue: [69, 65, 59, 62, 55, 52, 49, 53, 47, 45]
  };

  function snapshotsFor(productId) {
    return (priceSeries[productId] || []).map(function(price, index) {
      return {
        id: 'sample_snap_' + productId + '_' + index,
        productId: productId,
        capturedAt: daysAgo((priceSeries[productId].length - index) * 8),
        listPrice: price + 20,
        promoPrice: price + 10,
        couponPrice: price,
        finalPrice: price,
        promotionInfo: '示例价格记录',
        couponInfo: '',
        stockStatus: 'in_stock',
        source: 'sample',
        createdAt: daysAgo((priceSeries[productId].length - index) * 8)
      };
    });
  }

  function getSampleProducts() {
    return products.map(function(product) {
      return Object.assign({}, product);
    });
  }

  function getSampleSnapshots(productId) {
    return snapshotsFor(productId);
  }

  return {
    getSampleProducts: getSampleProducts,
    getSampleSnapshots: getSampleSnapshots
  };
});
```

- [ ] **Step 2: Create IndexedDB module**

Create `tools/price/js/db.js` with object stores `products`, `priceSnapshots`, `watches`, and `opLogs`:

```js
(function(root, factory) {
  root.ZhenjiaDB = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  var DB_NAME = 'zhenjiaAssistantDB';
  var DB_VERSION = 1;
  var STORE_NAMES = ['products', 'priceSnapshots', 'watches', 'opLogs'];

  function createId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function openDatabase() {
    return new Promise(function(resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains('products')) {
          var products = db.createObjectStore('products', { keyPath: 'id' });
          products.createIndex('platformItem', ['platform', 'itemId'], { unique: false });
          products.createIndex('source', 'source', { unique: false });
        }
        if (!db.objectStoreNames.contains('priceSnapshots')) {
          var snapshots = db.createObjectStore('priceSnapshots', { keyPath: 'id' });
          snapshots.createIndex('productId', 'productId', { unique: false });
          snapshots.createIndex('capturedAt', 'capturedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('watches')) {
          var watches = db.createObjectStore('watches', { keyPath: 'id' });
          watches.createIndex('productId', 'productId', { unique: false });
          watches.createIndex('enabled', 'enabled', { unique: false });
        }
        if (!db.objectStoreNames.contains('opLogs')) {
          var opLogs = db.createObjectStore('opLogs', { keyPath: 'id' });
          opLogs.createIndex('entityType', 'entityType', { unique: false });
          opLogs.createIndex('syncState', 'syncState', { unique: false });
        }
      };
      request.onsuccess = function(event) { resolve(event.target.result); };
      request.onerror = function() { reject(request.error); };
    });
  }

  function requestToPromise(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error); };
    });
  }

  function transactionDone(transaction) {
    return new Promise(function(resolve, reject) {
      transaction.oncomplete = resolve;
      transaction.onerror = function() { reject(transaction.error); };
      transaction.onabort = function() { reject(transaction.error); };
    });
  }

  function getAll(storeName) {
    return openDatabase().then(function(db) {
      var transaction = db.transaction(storeName, 'readonly');
      var request = transaction.objectStore(storeName).getAll();
      return requestToPromise(request).finally(function() { db.close(); });
    });
  }

  function getAllData() {
    return Promise.all(STORE_NAMES.map(getAll)).then(function(results) {
      return {
        products: results[0],
        priceSnapshots: results[1],
        watches: results[2],
        opLogs: results[3]
      };
    });
  }

  function writeWithOp(storeName, entity, action, payload) {
    return openDatabase().then(function(db) {
      var transaction = db.transaction([storeName, 'opLogs'], 'readwrite');
      transaction.objectStore(storeName).put(entity);
      transaction.objectStore('opLogs').put({
        id: createId('op'),
        entityType: storeName === 'priceSnapshots' ? 'priceSnapshot' : storeName.replace(/s$/, ''),
        entityId: entity.id,
        action: action,
        payload: payload || entity,
        clientTs: nowIso(),
        syncState: 'local'
      });
      return transactionDone(transaction).then(function() {
        db.close();
        return entity;
      });
    });
  }

  function upsertProduct(input) {
    var timestamp = nowIso();
    var product = Object.assign({
      id: createId('product'),
      platform: 'unknown',
      itemId: '',
      skuId: '',
      shopId: '',
      title: '未命名商品',
      shopName: '',
      imageUrl: '',
      rawUrl: '',
      canonicalUrl: '',
      source: 'parsed',
      createdAt: timestamp,
      updatedAt: timestamp
    }, input || {}, { updatedAt: timestamp });
    return writeWithOp('products', product, 'create');
  }

  function addPriceSnapshot(input) {
    var timestamp = nowIso();
    var snapshot = Object.assign({
      id: createId('snap'),
      productId: '',
      capturedAt: timestamp,
      listPrice: 0,
      promoPrice: 0,
      couponPrice: 0,
      finalPrice: 0,
      promotionInfo: '',
      couponInfo: '',
      stockStatus: 'unknown',
      source: 'manual',
      createdAt: timestamp
    }, input || {});
    return writeWithOp('priceSnapshots', snapshot, 'create');
  }

  function upsertWatch(input) {
    var timestamp = nowIso();
    var watch = Object.assign({
      id: createId('watch'),
      productId: '',
      targetPrice: 0,
      watchType: 'target_price',
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    }, input || {}, { updatedAt: timestamp });
    return writeWithOp('watches', watch, 'create');
  }

  function deleteOne(storeName, id) {
    return openDatabase().then(function(db) {
      var transaction = db.transaction([storeName, 'opLogs'], 'readwrite');
      transaction.objectStore(storeName).delete(id);
      transaction.objectStore('opLogs').put({
        id: createId('op'),
        entityType: storeName.replace(/s$/, ''),
        entityId: id,
        action: 'delete',
        payload: { id: id },
        clientTs: nowIso(),
        syncState: 'local'
      });
      return transactionDone(transaction).then(function() {
        db.close();
      });
    });
  }

  function clearAll() {
    return openDatabase().then(function(db) {
      var transaction = db.transaction(STORE_NAMES, 'readwrite');
      STORE_NAMES.forEach(function(storeName) {
        transaction.objectStore(storeName).clear();
      });
      return transactionDone(transaction).then(function() { db.close(); });
    });
  }

  return {
    getAll: getAll,
    getAllData: getAllData,
    upsertProduct: upsertProduct,
    addPriceSnapshot: addPriceSnapshot,
    upsertWatch: upsertWatch,
    deleteOne: deleteOne,
    clearAll: clearAll
  };
});
```

- [ ] **Step 3: Create chart module**

Create `tools/price/js/chart.js` with SVG rendering and fixed empty-state behavior:

```js
(function(root, factory) {
  root.ZhenjiaChart = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  function formatPrice(price) {
    return '¥' + Number(price || 0).toFixed(0);
  }

  function renderPriceChart(container, snapshots) {
    if (!container) return;
    var list = (snapshots || []).slice().sort(function(a, b) {
      return String(a.capturedAt).localeCompare(String(b.capturedAt));
    });
    if (list.length < 2) {
      container.innerHTML = '<div class="chart-empty">价格记录不足，先记录一次当前价。</div>';
      return;
    }

    var width = 720;
    var height = 240;
    var padding = 28;
    var prices = list.map(function(snapshot) { return Number(snapshot.finalPrice || 0); });
    var min = Math.min.apply(null, prices);
    var max = Math.max.apply(null, prices);
    var range = Math.max(1, max - min);
    var points = list.map(function(snapshot, index) {
      var x = padding + (index / Math.max(1, list.length - 1)) * (width - padding * 2);
      var y = height - padding - ((Number(snapshot.finalPrice || 0) - min) / range) * (height - padding * 2);
      return { x: x, y: y, price: snapshot.finalPrice };
    });
    var path = points.map(function(point, index) {
      return (index === 0 ? 'M' : 'L') + point.x.toFixed(2) + ' ' + point.y.toFixed(2);
    }).join(' ');
    var circles = points.map(function(point) {
      return '<circle cx="' + point.x.toFixed(2) + '" cy="' + point.y.toFixed(2) + '" r="4"><title>' + formatPrice(point.price) + '</title></circle>';
    }).join('');

    container.innerHTML = [
      '<svg class="price-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="历史价格曲线">',
      '<line class="chart-axis" x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '"></line>',
      '<text class="chart-label" x="' + padding + '" y="20">' + formatPrice(max) + '</text>',
      '<text class="chart-label" x="' + padding + '" y="' + (height - 8) + '">' + formatPrice(min) + '</text>',
      '<path class="chart-line" d="' + path + '"></path>',
      '<g class="chart-points">' + circles + '</g>',
      '</svg>'
    ].join('');
  }

  return {
    renderPriceChart: renderPriceChart
  };
});
```

- [ ] **Step 4: Syntax-check data modules**

Run:

```powershell
node --check tools/price/js/sample-data.js
node --check tools/price/js/db.js
node --check tools/price/js/chart.js
```

Expected: no output and exit code 0 for each command.

- [ ] **Step 5: Commit persistence and chart modules**

Run:

```powershell
git add tools/price/js/sample-data.js tools/price/js/db.js tools/price/js/chart.js
git commit -m "feat(price): add local data and chart modules"
```

### Task 3: App Shell, Visual System, and UI Layout

**Files:**
- Create: `tools/price/index.html`
- Create: `tools/price/css/style.css`

- [ ] **Step 1: Create HTML app shell**

Create `tools/price/index.html` with semantic views and versioned scripts:

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<script>
  (function() {
    var preference = localStorage.getItem('quick-tools-theme') || 'light';
    var theme = preference === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0F766E">
<meta name="description" content="真价助手：本地优先的买前查价与真低价判断工具。">
<link rel="manifest" href="/tools/price/manifest.json">
<link rel="apple-touch-icon" href="/icons/icon-192x192.png">
<link rel="stylesheet" href="/shared/css/pwa.css?v=2">
<link rel="stylesheet" href="/tools/price/css/style.css?v=100">
<title>真价助手 - 买前查价</title>
</head>
<body>
<header class="app-header">
  <a class="brand" href="#home" data-view-link="home" aria-label="返回真价助手首页">
    <span class="brand-mark">价</span>
    <span>
      <strong>真价助手</strong>
      <small>买前查验价格，不被假低价带节奏</small>
    </span>
  </a>
  <a class="header-link" href="/" aria-label="返回 Quick Tools">Quick Tools</a>
</header>

<main class="app-shell">
  <section class="view active" id="view-home" aria-labelledby="home-title">
    <div class="hero-panel">
      <div class="hero-copy">
        <p class="eyebrow">本地验证版</p>
        <h1 id="home-title">粘贴商品链接，先看是不是值得买</h1>
        <p>首版用本地记录和示例数据判断价格区间。真实采集、优惠券和通知后续接入。</p>
      </div>
      <form class="search-card" id="parse-form">
        <label for="product-input">商品链接或分享文本</label>
        <textarea id="product-input" rows="4" placeholder="粘贴京东、淘宝、天猫、拼多多商品详情页链接"></textarea>
        <div class="form-actions">
          <button class="btn primary" type="submit">立即分析</button>
          <button class="btn ghost" type="button" id="use-sample-button">看示例</button>
        </div>
        <p class="form-message" id="parse-message" role="status"></p>
      </form>
    </div>

    <section class="support-strip" aria-label="支持平台">
      <span>京东</span><span>淘宝</span><span>天猫</span><span>拼多多</span>
    </section>

    <section class="section-block" aria-labelledby="sample-title">
      <div class="section-head">
        <div>
          <p class="eyebrow">示例商品</p>
          <h2 id="sample-title">不用真实 API，也能体验完整判断</h2>
        </div>
      </div>
      <div class="product-grid" id="sample-products"></div>
    </section>

    <section class="section-block" aria-labelledby="recent-title">
      <div class="section-head">
        <div>
          <p class="eyebrow">本地关注</p>
          <h2 id="recent-title">最近关注</h2>
        </div>
      </div>
      <div class="stack-list" id="recent-watches"></div>
    </section>
  </section>

  <section class="view" id="view-analysis" aria-labelledby="analysis-title">
    <button class="text-button" type="button" data-view-link="home">返回首页</button>
    <div class="truth-bench" id="truth-bench"></div>
    <section class="section-block">
      <div class="section-head">
        <div>
          <p class="eyebrow">价格曲线</p>
          <h2 id="analysis-title">本地历史价格</h2>
        </div>
        <div class="range-tabs" id="range-tabs">
          <button type="button" data-range="30" class="active">30 天</button>
          <button type="button" data-range="90">90 天</button>
          <button type="button" data-range="all">全部</button>
        </div>
      </div>
      <div class="chart-panel" id="price-chart"></div>
    </section>
    <section class="detail-grid">
      <form class="panel" id="snapshot-form">
        <h2>记录一次价格</h2>
        <label>当前参考价 <input id="snapshot-price" type="number" min="0" step="0.01" required></label>
        <label>备注 <input id="snapshot-note" type="text" placeholder="例如：店铺券后价"></label>
        <button class="btn primary" type="submit">记录价格</button>
      </form>
      <form class="panel" id="watch-form">
        <h2>本地关注</h2>
        <label>目标价 <input id="watch-target" type="number" min="0" step="0.01" required></label>
        <button class="btn secondary" type="submit">加入关注</button>
        <p class="fine-print">首版只保存本地关注，不发送通知。</p>
      </form>
    </section>
  </section>

  <section class="view" id="view-watches" aria-labelledby="watches-title">
    <div class="section-head">
      <div>
        <p class="eyebrow">关注</p>
        <h1 id="watches-title">本地关注清单</h1>
      </div>
    </div>
    <div class="stack-list" id="watch-list"></div>
  </section>

  <section class="view" id="view-data" aria-labelledby="data-title">
    <div class="section-head">
      <div>
        <p class="eyebrow">数据</p>
        <h1 id="data-title">本地数据</h1>
      </div>
    </div>
    <section class="panel data-panel">
      <p>数据默认保存在本机 IndexedDB。导出文件包含商品、价格记录、关注目标和本地操作日志。</p>
      <div class="button-row">
        <button class="btn secondary" id="export-button" type="button">导出数据</button>
        <label class="btn ghost file-button">导入数据<input id="import-file" type="file" accept="application/json"></label>
        <button class="btn danger" id="clear-button" type="button">清空本地数据</button>
      </div>
      <p class="form-message" id="data-message" role="status"></p>
    </section>
  </section>
</main>

<nav class="bottom-nav" aria-label="主导航">
  <button class="nav-item active" type="button" data-view="home">查价</button>
  <button class="nav-item" type="button" data-view="watches">关注</button>
  <button class="nav-item" type="button" data-view="data">数据</button>
</nav>

<script src="/tools/price/js/link-parser.js?v=100"></script>
<script src="/tools/price/js/price-judge.js?v=100"></script>
<script src="/tools/price/js/export.js?v=100"></script>
<script src="/tools/price/js/sample-data.js?v=100"></script>
<script src="/tools/price/js/db.js?v=100"></script>
<script src="/tools/price/js/chart.js?v=100"></script>
<script src="/tools/price/js/app.js?v=100"></script>
</body>
</html>
```

- [ ] **Step 2: Create visual system CSS**

Create `tools/price/css/style.css` with the confirmed A direction:

```css
:root {
  --color-ink: #0F172A;
  --color-muted: #64748B;
  --color-surface: #FFFFFF;
  --color-page: #F7FAF8;
  --color-primary: #0F766E;
  --color-primary-soft: #CCFBF1;
  --color-accent: #D97706;
  --color-danger: #DC2626;
  --color-border: #DCE7E2;
  --shadow-soft: 0 18px 42px rgba(15, 23, 42, 0.08);
  --radius: 10px;
}

[data-theme="dark"] {
  --color-ink: #E5E7EB;
  --color-muted: #94A3B8;
  --color-surface: #111827;
  --color-page: #071312;
  --color-primary: #2DD4BF;
  --color-primary-soft: rgba(45, 212, 191, 0.14);
  --color-accent: #F59E0B;
  --color-danger: #F87171;
  --color-border: #1F3936;
  --shadow-soft: 0 18px 42px rgba(0, 0, 0, 0.3);
}

* { box-sizing: border-box; }
html { min-height: 100%; background: var(--color-page); }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--color-page);
  color: var(--color-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
}

button, input, textarea {
  font: inherit;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px max(18px, env(safe-area-inset-left)) 14px max(18px, env(safe-area-inset-right));
  background: color-mix(in srgb, var(--color-page) 86%, transparent);
  border-bottom: 1px solid var(--color-border);
  backdrop-filter: blur(16px);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: inherit;
  text-decoration: none;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--color-primary);
  color: #fff;
  font-weight: 800;
}

.brand strong, .brand small { display: block; }
.brand small { color: var(--color-muted); font-size: 12px; margin-top: 2px; }
.header-link { color: var(--color-muted); text-decoration: none; font-size: 14px; }

.app-shell {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 24px 18px 104px;
}

.view { display: none; }
.view.active { display: block; }

.hero-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
  gap: 20px;
  align-items: stretch;
  margin: 22px 0;
}

.hero-copy, .search-card, .section-block, .panel, .truth-bench {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-soft);
}

.hero-copy {
  padding: clamp(24px, 5vw, 46px);
  min-height: 300px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
}

h1, h2, h3, p { letter-spacing: 0; }
h1 { margin: 0; font-size: clamp(32px, 6vw, 58px); line-height: 1.04; }
h2 { margin: 0; font-size: 22px; line-height: 1.22; }
.hero-copy p:not(.eyebrow) { color: var(--color-muted); font-size: 17px; line-height: 1.72; max-width: 560px; }

.search-card, .panel { padding: 18px; }
.search-card label, .panel label { display: grid; gap: 8px; color: var(--color-muted); font-size: 13px; font-weight: 700; }
textarea, input {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-page);
  color: var(--color-ink);
  padding: 12px;
  resize: vertical;
}

.form-actions, .button-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.btn {
  border: 0;
  border-radius: 8px;
  padding: 11px 16px;
  cursor: pointer;
  font-weight: 800;
}
.btn.primary { background: var(--color-primary); color: #fff; }
.btn.secondary { background: var(--color-primary-soft); color: var(--color-primary); }
.btn.ghost { background: transparent; color: var(--color-primary); border: 1px solid var(--color-border); }
.btn.danger { background: color-mix(in srgb, var(--color-danger) 12%, transparent); color: var(--color-danger); }
.text-button { border: 0; background: transparent; color: var(--color-primary); font-weight: 800; padding: 0; margin: 0 0 16px; cursor: pointer; }

.support-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 22px;
}
.support-strip span {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: 999px;
  padding: 8px 12px;
  color: var(--color-muted);
}

.section-block { padding: 18px; margin: 18px 0; box-shadow: none; }
.section-head { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 14px; }
.product-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.stack-list { display: grid; gap: 10px; }

.truth-bench {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 170px;
  gap: 18px;
  padding: 22px;
  margin-bottom: 18px;
}
.score-ring {
  width: 132px;
  height: 132px;
  border-radius: 50%;
  background: conic-gradient(var(--color-primary) calc(var(--score, 0) * 1%), var(--color-border) 0);
  display: grid;
  place-items: center;
}
.score-ring span {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: var(--color-surface);
  display: grid;
  place-items: center;
  font-size: 30px;
  font-weight: 900;
}

.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.chart-panel { min-height: 260px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-page); overflow: hidden; }
.price-chart-svg { width: 100%; height: 260px; display: block; }
.chart-axis { stroke: var(--color-border); stroke-width: 1; }
.chart-line { fill: none; stroke: var(--color-primary); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.chart-points circle { fill: var(--color-surface); stroke: var(--color-primary); stroke-width: 3; }
.chart-label { fill: var(--color-muted); font-size: 12px; }
.chart-empty { min-height: 260px; display: grid; place-items: center; color: var(--color-muted); }

.bottom-nav {
  position: fixed;
  left: 50%;
  bottom: max(14px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
}
.nav-item {
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--color-muted);
  padding: 10px 18px;
  cursor: pointer;
  font-weight: 800;
}
.nav-item.active { background: var(--color-primary); color: #fff; }

.form-message, .fine-print { color: var(--color-muted); font-size: 13px; line-height: 1.5; }
.file-button input { display: none; }

@media (max-width: 860px) {
  .hero-panel, .truth-bench, .detail-grid { grid-template-columns: 1fr; }
  .product-grid { grid-template-columns: 1fr; }
  h1 { font-size: 34px; }
  .section-head { align-items: start; flex-direction: column; }
}
```

- [ ] **Step 3: Syntax and whitespace check**

Run:

```powershell
git diff --check -- tools/price/index.html tools/price/css/style.css
```

Expected: no output and exit code 0.

- [ ] **Step 4: Commit app shell and CSS**

Run:

```powershell
git add tools/price/index.html tools/price/css/style.css
git commit -m "feat(price): add app shell and visual system"
```

### Task 4: Browser App Logic

**Files:**
- Create: `tools/price/js/app.js`

- [ ] **Step 1: Implement app state and rendering**

Create `tools/price/js/app.js` with these responsibilities:

```js
(function() {
  var parser = window.ZhenjiaLinkParser;
  var judge = window.ZhenjiaPriceJudge;
  var db = window.ZhenjiaDB;
  var chart = window.ZhenjiaChart;
  var sampleData = window.ZhenjiaSampleData;
  var exporter = window.ZhenjiaExport;

  var state = {
    view: 'home',
    activeProduct: null,
    activeSnapshots: [],
    activeWatch: null,
    products: [],
    watches: [],
    snapshots: [],
    range: '30'
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function money(value) {
    var number = Number(value || 0);
    return number > 0 ? '¥' + number.toFixed(number % 1 ? 2 : 0) : '暂无';
  }

  function setMessage(id, text) {
    var element = document.getElementById(id);
    if (element) element.textContent = text || '';
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach(function(section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
    document.querySelectorAll('.nav-item').forEach(function(button) {
      button.classList.toggle('active', button.dataset.view === view);
    });
    location.hash = view === 'home' ? '#home' : '#' + view;
  }

  function platformLabel(platform) {
    return parser.normalizePlatformLabel(platform);
  }

  function productCard(product, options) {
    var mode = options && options.mode;
    return [
      '<article class="panel product-card">',
      '<p class="eyebrow">' + platformLabel(product.platform) + ' · ' + product.source + '</p>',
      '<h3>' + escapeHtml(product.title || '未命名商品') + '</h3>',
      '<p class="fine-print">' + escapeHtml(product.shopName || '本地记录') + '</p>',
      '<button class="btn secondary" type="button" data-product-id="' + product.id + '" data-open-product="' + (mode || 'sample') + '">查看分析</button>',
      '</article>'
    ].join('');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function renderSamples() {
    var container = $('#sample-products');
    if (!container) return;
    container.innerHTML = sampleData.getSampleProducts().map(function(product) {
      return productCard(product, { mode: 'sample' });
    }).join('');
  }

  function renderRecentWatches() {
    var container = $('#recent-watches');
    if (!container) return;
    var enabled = state.watches.filter(function(watch) { return watch.enabled; }).slice(0, 4);
    if (!enabled.length) {
      container.innerHTML = '<p class="fine-print">还没有本地关注。先分析一个商品，再设置目标价。</p>';
      return;
    }
    container.innerHTML = enabled.map(function(watch) {
      var product = state.products.find(function(item) { return item.id === watch.productId; });
      return '<article class="panel"><strong>' + escapeHtml(product ? product.title : watch.productId) + '</strong><p class="fine-print">目标价 ' + money(watch.targetPrice) + '</p></article>';
    }).join('');
  }

  function renderWatchList() {
    var container = $('#watch-list');
    if (!container) return;
    if (!state.watches.length) {
      container.innerHTML = '<p class="fine-print">本地关注清单为空。</p>';
      return;
    }
    container.innerHTML = state.watches.map(function(watch) {
      var product = state.products.find(function(item) { return item.id === watch.productId; });
      return '<article class="panel"><h2>' + escapeHtml(product ? product.title : watch.productId) + '</h2><p>目标价 ' + money(watch.targetPrice) + '</p><button class="btn ghost" type="button" data-delete-watch="' + watch.id + '">取消关注</button></article>';
    }).join('');
  }

  function snapshotsForProduct(productId) {
    return state.snapshots.filter(function(snapshot) {
      return snapshot.productId === productId;
    });
  }

  function filteredSnapshots(snapshots) {
    if (state.range === 'all') return snapshots;
    var days = Number(state.range || 30);
    var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return snapshots.filter(function(snapshot) {
      return new Date(snapshot.capturedAt).getTime() >= cutoff;
    });
  }

  function renderAnalysis(product, snapshots, watch) {
    state.activeProduct = product;
    state.activeSnapshots = snapshots;
    state.activeWatch = watch || null;
    var latest = snapshots.slice().sort(function(a, b) {
      return String(b.capturedAt).localeCompare(String(a.capturedAt));
    })[0];
    var currentPrice = latest ? latest.finalPrice : 0;
    var result = judge.judgePrice({
      currentFinalPrice: currentPrice,
      snapshots: snapshots,
      nowIso: new Date().toISOString()
    });
    $('#truth-bench').innerHTML = [
      '<div>',
      '<p class="eyebrow">' + platformLabel(product.platform) + ' · ' + escapeHtml(product.source) + '</p>',
      '<h1>' + escapeHtml(result.title) + '</h1>',
      '<p>' + escapeHtml(result.suggestion) + '</p>',
      '<p><strong>' + money(currentPrice) + '</strong> · ' + escapeHtml(product.title) + '</p>',
      '<ul>' + result.reasons.map(function(reason) { return '<li>' + escapeHtml(reason) + '</li>'; }).join('') + '</ul>',
      '</div>',
      '<div class="score-ring" style="--score:' + result.score + '"><span>' + result.score + '</span></div>'
    ].join('');
    chart.renderPriceChart($('#price-chart'), filteredSnapshots(snapshots));
    $('#watch-target').value = watch && watch.targetPrice ? watch.targetPrice : '';
    switchView('analysis');
  }

  function openSample(productId) {
    var product = sampleData.getSampleProducts().find(function(item) { return item.id === productId; });
    if (!product) return;
    renderAnalysis(product, sampleData.getSampleSnapshots(productId), null);
  }

  function loadAllData() {
    if (!window.indexedDB) {
      setMessage('parse-message', '浏览器不支持本地数据库，无法保存关注和价格记录。');
      renderSamples();
      return Promise.resolve();
    }
    return db.getAllData().then(function(data) {
      state.products = data.products;
      state.snapshots = data.priceSnapshots;
      state.watches = data.watches;
      renderSamples();
      renderRecentWatches();
      renderWatchList();
    });
  }

  function createParsedProduct(parsed) {
    return db.upsertProduct({
      platform: parsed.platform,
      itemId: parsed.itemId,
      skuId: parsed.skuId,
      shopId: parsed.shopId,
      title: parser.normalizePlatformLabel(parsed.platform) + '商品 ' + parsed.itemId,
      shopName: '本地解析',
      rawUrl: parsed.rawUrl,
      canonicalUrl: parsed.canonicalUrl,
      source: 'parsed'
    }).then(function(product) {
      state.products.push(product);
      return product;
    });
  }

  function ensureActiveProductSaved() {
    if (!state.activeProduct) return Promise.reject(new Error('missing active product'));
    var existing = state.products.find(function(product) {
      return product.id === state.activeProduct.id;
    });
    if (existing) return Promise.resolve(existing);
    return db.upsertProduct(Object.assign({}, state.activeProduct, {
      source: state.activeProduct.source === 'sample' ? 'sample' : state.activeProduct.source
    })).then(function(product) {
      state.products.push(product);
      state.activeProduct = product;
      return product;
    });
  }

  function bindEvents() {
    $('#parse-form').addEventListener('submit', function(event) {
      event.preventDefault();
      setMessage('parse-message', '');
      var result = parser.parseProductInput($('#product-input').value);
      if (!result.ok) {
        setMessage('parse-message', result.error.message);
        return;
      }
      createParsedProduct(result.data).then(function(product) {
        renderAnalysis(product, snapshotsForProduct(product.id), null);
      });
    });

    $('#use-sample-button').addEventListener('click', function() {
      openSample(sampleData.getSampleProducts()[0].id);
    });

    document.addEventListener('click', function(event) {
      var openButton = event.target.closest('[data-open-product]');
      if (openButton) openSample(openButton.dataset.productId);
      var viewButton = event.target.closest('[data-view], [data-view-link]');
      if (viewButton) switchView(viewButton.dataset.view || viewButton.dataset.viewLink);
      var rangeButton = event.target.closest('[data-range]');
      if (rangeButton) {
        state.range = rangeButton.dataset.range;
        document.querySelectorAll('[data-range]').forEach(function(button) {
          button.classList.toggle('active', button === rangeButton);
        });
        chart.renderPriceChart($('#price-chart'), filteredSnapshots(state.activeSnapshots));
      }
      var deleteWatch = event.target.closest('[data-delete-watch]');
      if (deleteWatch) {
        db.deleteOne('watches', deleteWatch.dataset.deleteWatch).then(loadAllData);
      }
    });

    $('#snapshot-form').addEventListener('submit', function(event) {
      event.preventDefault();
      if (!state.activeProduct) return;
      var price = Number($('#snapshot-price').value);
      if (!Number.isFinite(price) || price <= 0) return;
      ensureActiveProductSaved().then(function(product) {
        return db.addPriceSnapshot({
          productId: product.id,
          capturedAt: new Date().toISOString(),
          listPrice: price,
          promoPrice: price,
          couponPrice: price,
          finalPrice: price,
          promotionInfo: $('#snapshot-note').value,
          source: 'manual',
          stockStatus: 'unknown'
        });
      }).then(loadAllData).then(function() {
        renderAnalysis(state.activeProduct, snapshotsForProduct(state.activeProduct.id), state.activeWatch);
      });
    });

    $('#watch-form').addEventListener('submit', function(event) {
      event.preventDefault();
      if (!state.activeProduct) return;
      var target = Number($('#watch-target').value);
      if (!Number.isFinite(target) || target <= 0) return;
      ensureActiveProductSaved().then(function(product) {
        return db.upsertWatch({
          productId: product.id,
          targetPrice: target,
          watchType: 'target_price',
          enabled: true
        });
      }).then(loadAllData);
    });

    $('#export-button').addEventListener('click', function() {
      db.getAllData().then(function(data) {
        var payload = exporter.buildExportPayload(data);
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'zhenjia-assistant-backup.json';
        link.click();
        URL.revokeObjectURL(url);
      });
    });

    $('#clear-button').addEventListener('click', function() {
      if (confirm('确定清空真价助手的本地数据吗？')) {
        db.clearAll().then(loadAllData);
      }
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/tools/price/sw.js').catch(function(error) {
        console.warn('[Zhenjia] Service worker registration failed:', error);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    bindEvents();
    loadAllData();
    registerServiceWorker();
  });
})();
```

- [ ] **Step 2: Syntax-check app logic**

Run:

```powershell
node --check tools/price/js/app.js
```

Expected: no output and exit code 0.

- [ ] **Step 3: Commit app logic**

Run:

```powershell
git add tools/price/js/app.js
git commit -m "feat(price): wire local app interactions"
```

### Task 5: PWA Metadata, README, and Quick Tools Integration

**Files:**
- Create: `tools/price/manifest.json`
- Create: `tools/price/sw.js`
- Create: `tools/price/README.md`
- Modify: `index.html`
- Modify: `manifest.json`
- Modify: `sw.js`
- Modify: `vercel.json`

- [ ] **Step 1: Create standalone manifest**

Create `tools/price/manifest.json`:

```json
{
  "name": "真价助手 - 买前查价",
  "short_name": "真价助手",
  "description": "本地优先的买前查价与真低价判断工具。",
  "start_url": "/tools/price/",
  "display": "standalone",
  "background_color": "#F7FAF8",
  "theme_color": "#0F766E",
  "orientation": "portrait",
  "scope": "/tools/price/",
  "lang": "zh-CN",
  "icons": [
    { "src": "/icons/icon-72x72.png", "sizes": "72x72", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-96x96.png", "sizes": "96x96", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-128x128.png", "sizes": "128x128", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icons/icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable any" }
  ],
  "categories": ["shopping", "utilities", "productivity"],
  "related_applications": [],
  "prefer_related_applications": false
}
```

- [ ] **Step 2: Create tool service worker**

Create `tools/price/sw.js`:

```js
/**
 * 真价助手 - Service Worker
 * Cache-first app shell for the standalone price tool.
 */

const CACHE_NAME = 'zhenjia-assistant-v1';
const APP_SHELL = [
  '/tools/price/',
  '/tools/price/index.html',
  '/tools/price/manifest.json',
  '/tools/price/css/style.css?v=100',
  '/tools/price/js/link-parser.js?v=100',
  '/tools/price/js/price-judge.js?v=100',
  '/tools/price/js/export.js?v=100',
  '/tools/price/js/sample-data.js?v=100',
  '/tools/price/js/db.js?v=100',
  '/tools/price/js/chart.js?v=100',
  '/tools/price/js/app.js?v=100',
  '/shared/css/pwa.css?v=2',
  '/icons/icon-192x192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((error) => console.warn('[Zhenjia SW] Cache install failed:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith('zhenjia-assistant-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
```

- [ ] **Step 3: Create README**

Create `tools/price/README.md`:

```markdown
# 真价助手

真价助手是 `tools/price/` 下的本地优先买前查价工具，用于解析商品链接、记录本地历史价格、判断当前价格区间，并管理本地关注目标价。

## 范围

- 本地优先，无需登录即可使用。
- 数据保存在 IndexedDB `zhenjiaAssistantDB`。
- 支持京东、淘宝、天猫、拼多多商品详情页链接解析。
- 支持示例商品、手动价格记录、本地关注和 JSON 导入导出。
- 真实采集、优惠券、CPS 转链、邮箱提醒目前仅作为后续能力说明，不在首版启用。

## 本地验证

```powershell
node --test tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js
node --check tools/price/js/*.js
node --check tools/price/sw.js
git diff --check
```

使用新端口启动静态服务后访问 `/tools/price/`，避免旧 Service Worker 缓存影响验证。
```

- [ ] **Step 4: Modify root homepage**

In `index.html`, add CSS after `.tool-icon.time`:

```css
  .tool-icon.price {
    background: linear-gradient(135deg, #0F766E 0%, #D97706 100%);
  }
```

Add a tool card after 今日有序:

```html
    <a class="tool-card" href="./tools/price/">
      <div class="tool-icon price">价</div>
      <h2>真价助手</h2>
      <p>买前粘贴商品链接，识别平台并用本地价格记录判断是否真低价。首版本地优先，不登录也能开始。</p>
      <span class="tool-btn">开始使用 →</span>
    </a>
```

- [ ] **Step 5: Modify root manifest shortcut**

In `manifest.json`, append this object to `shortcuts`:

```json
    {
      "name": "真价助手",
      "short_name": "真价",
      "description": "买前查价与真低价判断",
      "url": "/tools/price/",
      "icons": [{ "src": "/icons/icon-96x96.png", "sizes": "96x96" }]
    }
```

- [ ] **Step 6: Modify root service worker**

In `sw.js`, add `/tools/price/` to `STATIC_ASSETS`:

```js
  '/tools/price/',
```

- [ ] **Step 7: Modify Vercel config**

In `vercel.json`, add a CSS/JS immutable header:

```json
    {
      "source": "/tools/price/(.*)\\.(css|js)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
```

Add a no-cache route header:

```json
    {
      "source": "/tools/price/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-cache, must-revalidate"
        }
      ]
    }
```

Add rewrites:

```json
    { "source": "/tools/price", "destination": "/tools/price/" },
    { "source": "/tools/price/", "destination": "/tools/price/index.html" }
```

- [ ] **Step 8: Run syntax and JSON checks**

Run:

```powershell
node --check tools/price/sw.js
node -e "JSON.parse(require('fs').readFileSync('tools/price/manifest.json','utf8')); JSON.parse(require('fs').readFileSync('manifest.json','utf8')); JSON.parse(require('fs').readFileSync('vercel.json','utf8'));"
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 9: Commit PWA and integration**

Run:

```powershell
git add tools/price/manifest.json tools/price/sw.js tools/price/README.md index.html manifest.json sw.js vercel.json
git commit -m "feat(price): integrate PWA entry"
```

### Task 6: Full Verification and Browser QA

**Files:**
- Verify only; no intended source edits unless checks fail.

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
node --test tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js
node --check tools/price/js/*.js
node --check tools/price/sw.js
git diff --check
```

Expected: tests pass, syntax checks produce no output, `git diff --check` exits 0.

- [ ] **Step 2: Start a fresh static server**

Use a new port that is not already in use:

```powershell
python -m http.server 8110 --bind 127.0.0.1
```

If port 8110 is occupied, use 8111 or another free port.

- [ ] **Step 3: Verify desktop browser flow**

Open:

```text
http://127.0.0.1:8110/tools/price/
```

Check these visible states:

- The first screen shows `真价助手`, the paste input, `立即分析`, `看示例`, and platform chips.
- Clicking `看示例` opens the analysis view.
- The analysis view shows the price truth bench, score ring, judgement title, reasons, and chart.
- Recording a manual price updates the chart and judgement without reloading the page.
- Setting a target price adds an item to the local watch list.
- The `关注` nav shows the watched product and target price.
- The `数据` nav shows export/import/clear controls and local mode copy.

- [ ] **Step 4: Verify mobile browser flow**

Set viewport around 390 x 844 and reload:

```text
http://127.0.0.1:8110/tools/price/
```

Check these layout states:

- The hero and input stack vertically.
- No button text overflows.
- The bottom nav does not cover form controls when scrolled to the bottom.
- The truth bench stacks cleanly and the score ring is fully visible.
- Chart text and line remain inside the chart panel.

- [ ] **Step 5: Verify root integration**

Open:

```text
http://127.0.0.1:8110/
```

Check:

- The root homepage shows the 真价助手 card.
- Clicking the card navigates to `/tools/price/`.
- The root service worker and tool service worker do not throw console errors.

- [ ] **Step 6: Commit verification fixes if needed**

If verification reveals fixes, commit only the fix files:

```powershell
git add <fixed-files>
git commit -m "fix(price): resolve verification issues"
```

If no fixes are needed, do not create an empty commit.

## Self-Review Checklist

- Spec coverage: tasks cover the local-first tool, link parsing, sample products, price judgement, manual price history, watches, import/export, PWA metadata, root entry integration, and verification.
- Explicit non-goals: plan does not implement real crawling, coupons, CPS, outbound notifications, login, or short-link backend expansion.
- Type consistency: product fields are `platform`, `itemId`, `skuId`, `shopId`, `title`, `shopName`, `imageUrl`, `rawUrl`, `canonicalUrl`, `source`, `createdAt`, `updatedAt`; snapshot fields are `productId`, `capturedAt`, `listPrice`, `promoPrice`, `couponPrice`, `finalPrice`, `promotionInfo`, `couponInfo`, `stockStatus`, `source`, `createdAt`; watch fields are `productId`, `targetPrice`, `watchType`, `enabled`, `createdAt`, `updatedAt`.
- No placeholders: every task lists exact files, exact commands, and concrete code or insertion snippets.
