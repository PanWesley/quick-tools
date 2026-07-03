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
