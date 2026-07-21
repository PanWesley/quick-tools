const test = require('node:test');
const assert = require('node:assert/strict');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('recordSnapshot sends only shared fields with a stable anonymous client ID', async () => {
  const { create } = require('./price-api.js');
  const calls = [];
  let uuidCalls = 0;
  const api = create({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ deduplicated: false });
    },
    storage: memoryStorage(),
    cryptoImpl: {
      randomUUID() {
        uuidCalls += 1;
        return 'client-12345678';
      }
    }
  });
  api.enabled = true;

  const input = {
    platform: 'jd',
    itemId: '123',
    finalPrice: 99,
    listPrice: 109,
    promoPrice: null,
    couponPrice: null,
    stockStatus: 'unknown',
    title: '商品',
    note: '直播间价格',
    capturedAt: '2020-01-01T00:00:00.000Z'
  };
  await api.recordSnapshot(input);
  await api.recordSnapshot(input);

  assert.equal(uuidCalls, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['X-Price-Client-ID'], 'client-12345678');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body, {
    platform: 'jd',
    itemId: '123',
    finalPrice: 99,
    listPrice: 109,
    promoPrice: null,
    couponPrice: null,
    stockStatus: 'unknown',
    title: '商品'
  });
  assert.equal(body.note, undefined);
  assert.equal(body.capturedAt, undefined);
});

test('recordSnapshot preserves structured API errors', async () => {
  const { create } = require('./price-api.js');
  const api = create({
    fetchImpl: async () => jsonResponse({
      error: { code: 'rate_limited', message: 'Too many requests.', retryable: true }
    }, 429),
    storage: memoryStorage(),
    cryptoImpl: { randomUUID: () => 'client-12345678' }
  });
  api.enabled = true;

  const result = await api.recordSnapshot({ platform: 'jd', itemId: '123', finalPrice: 99 });

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: 'rate_limited',
    message: 'Too many requests.',
    retryable: true
  });
});

test('recordSnapshot returns duplicate status as successful shared history sync', async () => {
  const { create } = require('./price-api.js');
  const api = create({
    fetchImpl: async () => jsonResponse({ deduplicated: true, snapshotCount: 4 }),
    storage: memoryStorage(),
    cryptoImpl: { randomUUID: () => 'client-12345678' }
  });
  api.enabled = true;

  const result = await api.recordSnapshot({ platform: 'jd', itemId: '123', finalPrice: 99 });

  assert.equal(result.ok, true);
  assert.equal(result.data.deduplicated, true);
  assert.equal(result.data.snapshotCount, 4);
});

test('init enables the API only after a successful config response', async () => {
  const { create } = require('./price-api.js');
  const successful = create({ fetchImpl: async () => jsonResponse({ version: '1.0.0' }) });
  const unavailable = create({ fetchImpl: async () => jsonResponse({ error: {} }, 503) });

  assert.equal(await successful.init(), true);
  assert.equal(successful.enabled, true);
  assert.equal(await unavailable.init(), false);
  assert.equal(unavailable.enabled, false);
});
