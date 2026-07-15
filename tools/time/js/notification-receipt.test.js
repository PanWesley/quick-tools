const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

class FakeCache {
  constructor() {
    this.records = new Map();
  }

  key(value) {
    return typeof value === 'string' ? value : value.url;
  }

  async match(value) {
    const response = this.records.get(this.key(value));
    return response ? response.clone() : undefined;
  }

  async put(value, response) {
    this.records.set(this.key(value), response.clone());
  }

  async delete(value) {
    return this.records.delete(this.key(value));
  }

  async keys() {
    return Array.from(this.records.keys(), url => new Request(url));
  }
}

function createFakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name);
    },
    dump() {
      return Array.from(stores.entries(), ([name, cache]) => ({
        name,
        records: Array.from(cache.records.entries())
      }));
    }
  };
}

const NOW = Date.parse('2026-07-15T04:14:00.000Z');
const RECEIPT_CACHE = 'today-youxu-notification-receipts-v1';

test('delivery receipts hash private tags and expire after 48 hours', async () => {
  const Receipt = require('./notification-receipt.js');
  const caches = createFakeCaches();
  let clock = NOW;
  const receipts = Receipt.create({ caches, crypto: webcrypto, now: () => clock });

  assert.equal(await receipts.has('task:private-id:123'), false);
  assert.equal(await receipts.record('task:private-id:123', NOW - 1000), true);
  assert.equal(await receipts.has('task:private-id:123'), true);
  const cache = await caches.open(RECEIPT_CACHE);
  const [url] = cache.records.keys();
  assert.doesNotMatch(url, /private-id|task:private/);
  assert.deepEqual(await (await cache.match(url)).json(), {
    shownAt: 1784088840000,
    scheduledAt: 1784088839000
  });

  clock += (48 * 60 * 60 * 1000) + 1;
  await receipts.clearExpired();
  assert.equal(await receipts.has('task:private-id:123'), false);
});

test('failure diagnostics accept only bounded categories and clear after success', async () => {
  const Receipt = require('./notification-receipt.js');
  const caches = createFakeCaches();
  const receipts = Receipt.create({ caches, crypto: webcrypto, now: () => NOW });

  for (const code of Receipt.FAILURE_CODES) {
    assert.equal(await receipts.recordFailure(code), true);
    assert.deepEqual(await receipts.getFailure(), { code, at: NOW });
  }
  assert.equal(await receipts.recordFailure('raw decrypt error with ciphertext'), false);
  assert.equal(JSON.stringify(caches.dump()).includes('raw decrypt error'), false);
  assert.equal(await receipts.clearFailure(), true);
  assert.equal(await receipts.getFailure(), null);
});

test('malformed cache values are removed and unavailable storage fails open', async () => {
  const Receipt = require('./notification-receipt.js');
  const caches = createFakeCaches();
  const receipts = Receipt.create({ caches, crypto: webcrypto, now: () => NOW });
  const cache = await caches.open(RECEIPT_CACHE);
  await cache.put(
    'https://billnest.top/tools/time/__notification_receipt__/broken',
    new Response(JSON.stringify({ shownAt: 'private', scheduledAt: NOW }))
  );
  await receipts.clearExpired();
  assert.equal(cache.records.size, 0);

  const unavailable = Receipt.create({ caches: null, crypto: null, now: () => NOW });
  assert.equal(await unavailable.has('task:private-id:123'), false);
  assert.equal(await unavailable.record('task:private-id:123', NOW), false);
  assert.equal(await unavailable.recordFailure('missing_key'), false);
  assert.equal(await unavailable.getFailure(), null);
  assert.equal(await unavailable.clearFailure(), false);
  await assert.doesNotReject(() => unavailable.clearExpired());
});

test('receipt validation rejects extra fields and invalid timestamps', async () => {
  const Receipt = require('./notification-receipt.js');
  const caches = createFakeCaches();
  const receipts = Receipt.create({ caches, crypto: webcrypto, now: () => NOW });
  assert.equal(await receipts.record('task:one', NaN), false);

  const cache = await caches.open(RECEIPT_CACHE);
  const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('task:one'));
  const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  const url = `https://billnest.top/tools/time/__notification_receipt__/${hex}`;
  await cache.put(url, new Response(JSON.stringify({ shownAt: NOW, scheduledAt: NOW, title: 'private' })));

  assert.equal(await receipts.has('task:one'), false);
  assert.equal(cache.records.has(url), false);
});
