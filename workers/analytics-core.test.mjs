import assert from 'node:assert';
import {
  createAggregationPlan,
  normalizeCloudflareLocation,
  normalizeIncomingEvent,
  summarizeDailyRows
} from './analytics-core.mjs';

const normalized = normalizeIncomingEvent({
  type: 'page_view',
  tool: 'expense',
  route: '/tools/expense/#view=dashboard',
  view: 'dashboard',
  sessionId: 'session-1',
  standalone: true,
  device: 'mobile',
  referrer: 'external',
  amount: 88,
  note: 'private note',
  tags: ['secret']
}, new Date('2026-07-02T10:00:00.000Z'));

assert.deepStrictEqual(normalized, {
  day: '2026-07-02',
  type: 'page_view',
  tool: 'expense',
  route: '/tools/expense/#view=dashboard',
  view: 'dashboard',
  sessionId: 'session-1',
  standalone: true,
  device: 'mobile',
  referrer: 'external',
  feature: null,
  durationSeconds: 0
});

assert.deepStrictEqual(normalizeCloudflareLocation({
  country: 'cn',
  colo: 'hkg'
}), {
  country: 'CN',
  colo: 'HKG'
});
assert.deepStrictEqual(normalizeCloudflareLocation({}), {
  country: 'unknown',
  colo: 'unknown'
});

const plan = createAggregationPlan(
  normalized,
  'visitor-key-1',
  '2026-07-02T10:00:00.000Z',
  { country: 'CN', colo: 'HKG' }
);
assert.strictEqual(plan.visitor.day, '2026-07-02');
assert.strictEqual(plan.session.sessionId, 'session-1');
assert.deepStrictEqual(plan.eventBucket, {
  day: '2026-07-02',
  type: 'page_view',
  name: 'dashboard',
  route: '/tools/expense/#view=dashboard',
  incrementBy: 1,
  engagedSeconds: 0
});
assert.deepStrictEqual(plan.toolVisitor, {
  day: '2026-07-02',
  tool: 'expense',
  visitorKey: 'visitor-key-1'
});
assert.deepStrictEqual(plan.deviceVisitor, {
  day: '2026-07-02',
  device: 'mobile',
  visitorKey: 'visitor-key-1'
});
assert.deepStrictEqual(plan.referrerVisitor, {
  day: '2026-07-02',
  referrer: 'external',
  visitorKey: 'visitor-key-1'
});
assert.deepStrictEqual(plan.locationVisitor, {
  day: '2026-07-02',
  country: 'CN',
  colo: 'HKG',
  visitorKey: 'visitor-key-1'
});
assert.deepStrictEqual(plan.toolBucket, {
  day: '2026-07-02',
  tool: 'expense',
  incrementBy: 1,
  engagedSeconds: 0
});

const engagementPlan = createAggregationPlan({
  ...normalized,
  type: 'engagement',
  durationSeconds: 30
}, 'visitor-key-1', '2026-07-02T10:00:30.000Z');
assert.strictEqual(engagementPlan.session.engagedSeconds, 30);
assert.strictEqual(engagementPlan.eventBucket.engagedSeconds, 30);
assert.strictEqual(engagementPlan.toolBucket.engagedSeconds, 30);

assert.deepStrictEqual(summarizeDailyRows([
  {
    day: '2026-07-02',
    visitors: 3,
    sessions: 4,
    pageviews: 9,
    engagedSeconds: 240
  }
]), [
  {
    day: '2026-07-02',
    dau: 3,
    sessions: 4,
    pageviews: 9,
    engagedSeconds: 240,
    averageEngagedSeconds: 60
  }
]);

console.log('analytics worker core tests passed');
