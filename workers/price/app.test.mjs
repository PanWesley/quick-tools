import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceApp } from './app.mjs';

const FIXED_NOW = '2026-07-22T00:00:00.000Z';

function createMemoryKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key, type) {
      if (!values.has(key)) return null;
      const value = values.get(key);
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) {
      values.set(key, value);
    }
  };
}

function createLimiter(success = true) {
  const calls = [];
  return {
    calls,
    async limit(input) {
      calls.push(input);
      return { success };
    }
  };
}

function createEnv(overrides = {}) {
  return {
    ALLOWED_ORIGINS: 'https://billnest.top,https://www.billnest.top',
    SNAPSHOT_CLIENT_LIMITER: createLimiter(),
    SNAPSHOT_ITEM_LIMITER: createLimiter(),
    ...overrides
  };
}

function snapshotRequest(body, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (options.clientId !== null) {
    headers['X-Price-Client-ID'] = options.clientId || 'client-12345678';
  }
  return new Request('https://billnest.top/api/price/snapshot', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function responseJson(response) {
  return JSON.parse(await response.text());
}

async function readHistory(app, platform, itemId, env) {
  const response = await app.fetch(new Request(
    `https://billnest.top/api/price/history?platform=${platform}&item_id=${itemId}`
  ), env);
  assert.equal(response.status, 200);
  return responseJson(response);
}

function createApp(kv, options = {}) {
  return createPriceApp({
    kv,
    now: options.now || (() => new Date(FIXED_NOW)),
    fetchImpl: options.fetchImpl,
    shortLinkTimeoutMs: options.shortLinkTimeoutMs
  });
}

function resolveRequest(text) {
  return new Request('https://billnest.top/api/price/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: '', text })
  });
}

test('snapshot rejects requests without an anonymous client ID', async () => {
  const app = createApp(createMemoryKv());
  const response = await app.fetch(snapshotRequest({
    platform: 'jd', itemId: '123', finalPrice: 99
  }, { clientId: null }), createEnv());

  assert.equal(response.status, 400);
  assert.equal((await responseJson(response)).error.code, 'missing_client_id');
});

test('snapshot fails closed when rate limit bindings are missing', async () => {
  const app = createApp(createMemoryKv());
  const response = await app.fetch(snapshotRequest({
    platform: 'jd', itemId: '123', finalPrice: 99
  }), createEnv({ SNAPSHOT_CLIENT_LIMITER: undefined }));

  assert.equal(response.status, 503);
  assert.equal((await responseJson(response)).error.code, 'rate_limit_unavailable');
});

test('snapshot enforces client and item rate limits', async () => {
  const app = createApp(createMemoryKv());
  const clientLimiter = createLimiter(false);
  const itemLimiter = createLimiter();
  const response = await app.fetch(snapshotRequest({
    platform: 'jd', itemId: '123', finalPrice: 99
  }), createEnv({
    SNAPSHOT_CLIENT_LIMITER: clientLimiter,
    SNAPSHOT_ITEM_LIMITER: itemLimiter
  }));

  assert.equal(response.status, 429);
  const body = await responseJson(response);
  assert.equal(body.error.code, 'rate_limited');
  assert.equal(body.error.retryable, true);
  assert.deepEqual(clientLimiter.calls, [{ key: 'snapshot:client-12345678' }]);
  assert.equal(itemLimiter.calls.length, 0);
});

test('snapshot rejects private note and client-owned timestamp fields', async () => {
  const app = createApp(createMemoryKv());
  for (const extra of [
    { note: '直播间价格' },
    { capturedAt: '2020-01-01T00:00:00.000Z' }
  ]) {
    const response = await app.fetch(snapshotRequest({
      platform: 'jd', itemId: '123', finalPrice: 99, ...extra
    }), createEnv());
    assert.equal(response.status, 400);
    assert.equal((await responseJson(response)).error.code, 'invalid_body');
  }
});

test('snapshot stores minimal data with a server-owned timestamp', async () => {
  const kv = createMemoryKv();
  const app = createApp(kv);
  const env = createEnv();
  const response = await app.fetch(snapshotRequest({
    platform: 'jd',
    itemId: '123',
    finalPrice: 99,
    title: '  商品   标题  '
  }), env);

  assert.equal(response.status, 200);
  const result = await responseJson(response);
  assert.equal(result.deduplicated, false);
  assert.equal(result.capturedAt, FIXED_NOW);
  const history = await readHistory(app, 'jd', '123', env);
  assert.deepEqual(history.snapshots[0], {
    finalPrice: 99,
    listPrice: 99,
    promoPrice: null,
    couponPrice: null,
    stockStatus: 'unknown',
    capturedAt: FIXED_NOW
  });
  assert.equal(JSON.parse(kv.values.get('product:jd:123')).title, '商品 标题');
});

test('snapshot deduplicates the same price within ten minutes', async () => {
  const kv = createMemoryKv();
  const app = createApp(kv);
  const env = createEnv();
  const body = { platform: 'jd', itemId: '123', finalPrice: 99 };

  assert.equal((await app.fetch(snapshotRequest(body), env)).status, 200);
  const duplicate = await app.fetch(snapshotRequest(body), env);
  assert.equal(duplicate.status, 200);
  assert.equal((await responseJson(duplicate)).deduplicated, true);
  assert.equal((await readHistory(app, 'jd', '123', env)).snapshotCount, 1);
});

test('snapshot rejects suspicious outliers after five valid prices', async () => {
  const existing = [90, 95, 100, 105, 110].map((finalPrice, index) => ({
    finalPrice,
    listPrice: finalPrice,
    promoPrice: null,
    couponPrice: null,
    stockStatus: 'unknown',
    capturedAt: `2026-07-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`
  }));
  const kv = createMemoryKv({ 'snapshots:jd:123': JSON.stringify(existing) });
  const app = createApp(kv);
  const response = await app.fetch(snapshotRequest({
    platform: 'jd', itemId: '123', finalPrice: 401
  }), createEnv());

  assert.equal(response.status, 422);
  assert.equal((await responseJson(response)).error.code, 'suspicious_price');
  assert.equal(JSON.parse(kv.values.get('snapshots:jd:123')).length, 5);
});

test('snapshot history is capped at the latest 500 entries', async () => {
  const existing = Array.from({ length: 500 }, (_, index) => ({
    finalPrice: 100 + (index % 2),
    listPrice: 100 + (index % 2),
    promoPrice: null,
    couponPrice: null,
    stockStatus: 'unknown',
    capturedAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * 60 * 60 * 1000).toISOString()
  }));
  const kv = createMemoryKv({ 'snapshots:jd:123': JSON.stringify(existing) });
  const app = createApp(kv);
  const env = createEnv();
  const response = await app.fetch(snapshotRequest({
    platform: 'jd', itemId: '123', finalPrice: 102
  }), env);

  assert.equal(response.status, 200);
  const history = await readHistory(app, 'jd', '123', env);
  assert.equal(history.snapshotCount, 500);
  assert.equal(history.snapshots.at(-1).finalPrice, 102);
});

test('short link resolution uses GET and resolves protocol-relative redirects', async () => {
  const calls = [];
  const app = createApp(createMemoryKv(), {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(null, {
        status: 302,
        headers: { Location: '//item.jd.com/100012043978.html' }
      });
    }
  });
  const response = await app.fetch(resolveRequest('https://3.cn/abc'), createEnv());
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(body.resolved, true);
  assert.equal(body.itemId, '100012043978');
});

test('short link resolution rejects HTML responses larger than 256 KiB', async () => {
  const app = createApp(createMemoryKv(), {
    fetchImpl: async () => new Response('x'.repeat(256 * 1024 + 1), {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    })
  });
  const response = await app.fetch(resolveRequest('https://3.cn/large'), createEnv());
  const body = await responseJson(response);

  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'response_too_large');
  assert.equal(body.error.retryable, true);
});

test('short link timeout remains active while reading the response body', async () => {
  const app = createApp(createMemoryKv(), {
    shortLinkTimeoutMs: 10,
    fetchImpl: async (url, options) => new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => {
          controller.error(new DOMException('Aborted', 'AbortError'));
        });
      }
    }), { status: 200 })
  });

  const result = await Promise.race([
    app.fetch(resolveRequest('https://3.cn/slow'), createEnv()),
    new Promise((resolve) => setTimeout(() => resolve('did-not-settle'), 100))
  ]);

  assert.notEqual(result, 'did-not-settle');
  assert.equal(result.status, 502);
  const body = await responseJson(result);
  assert.equal(body.error.code, 'timeout');
  assert.equal(body.error.retryable, true);
});
