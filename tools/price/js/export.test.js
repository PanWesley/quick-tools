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
