const assert = require('assert');

const {
  buildBreakdownRows,
  buildSummaryCards,
  buildToolRows,
  formatDuration,
  getLatestDailySummary
} = require('./dashboard-utils');

assert.strictEqual(formatDuration(0), '0秒');
assert.strictEqual(formatDuration(59), '59秒');
assert.strictEqual(formatDuration(60), '1分钟');
assert.strictEqual(formatDuration(125), '2分钟');
assert.strictEqual(formatDuration(3660), '1小时1分钟');

const latest = getLatestDailySummary([
  { day: '2026-07-01', dau: 2, sessions: 3, pageviews: 5, averageEngagedSeconds: 20 },
  { day: '2026-07-02', dau: 4, sessions: 6, pageviews: 9, averageEngagedSeconds: 42 }
]);

assert.deepStrictEqual(latest, {
  day: '2026-07-02',
  dau: 4,
  sessions: 6,
  pageviews: 9,
  averageEngagedSeconds: 42
});

assert.deepStrictEqual(buildSummaryCards({
  daily: [latest]
}), [
  { label: 'DAU', value: '4', hint: '2026-07-02' },
  { label: 'Sessions', value: '6', hint: '会话数' },
  { label: 'Pageviews', value: '9', hint: '页面浏览' },
  { label: 'Avg Time', value: '42秒', hint: '平均停留' }
]);

assert.deepStrictEqual(buildToolRows([
  { tool: 'expense', visitors: 4, pageviews: 8, engagedSeconds: 120 },
  { tool: 'time', visitors: 1, pageviews: 2, engagedSeconds: 30 }
]), [
  { key: 'expense', label: '生活账单', visitors: 4, pageviews: 8, engagedSeconds: 120, share: 80 },
  { key: 'time', label: '今日有序', visitors: 1, pageviews: 2, engagedSeconds: 30, share: 20 }
]);

assert.deepStrictEqual(buildToolRows([]), []);

assert.deepStrictEqual(buildBreakdownRows([
  { device: 'mobile', visitors: 3 },
  { device: 'desktop', visitors: 1 }
], 'device'), [
  { key: 'mobile', label: 'Mobile', visitors: 3, share: 75 },
  { key: 'desktop', label: 'Desktop', visitors: 1, share: 25 }
]);

assert.deepStrictEqual(buildBreakdownRows([
  { referrer: 'direct', visitors: 5 },
  { referrer: 'external', visitors: 3 }
], 'referrer'), [
  { key: 'direct', label: 'Direct', visitors: 5, share: 63 },
  { key: 'external', label: 'External', visitors: 3, share: 38 }
]);

assert.deepStrictEqual(buildBreakdownRows([
  { country: 'CN', colo: 'HKG', visitors: 2 }
], 'location'), [
  { key: 'CN-HKG', label: 'CN / HKG', visitors: 2, share: 100 }
]);

console.log('analytics dashboard utility tests passed');
