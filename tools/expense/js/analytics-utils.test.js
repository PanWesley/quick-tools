const assert = require('assert');
const {
  createAnalyticsEvent,
  getAnalyticsViewFromHash,
  getDeviceClass,
  sanitizeAnalyticsEvent
} = require('./analytics-utils');

assert.strictEqual(getAnalyticsViewFromHash('#view=dashboard'), 'dashboard');
assert.strictEqual(getAnalyticsViewFromHash('#view=list&tag=food'), 'list');
assert.strictEqual(getAnalyticsViewFromHash('#unknown'), 'add');
assert.strictEqual(getDeviceClass(390), 'mobile');
assert.strictEqual(getDeviceClass(900), 'tablet');
assert.strictEqual(getDeviceClass(1280), 'desktop');

const event = createAnalyticsEvent({
  type: 'page_view',
  view: 'dashboard',
  sessionId: 'session-123',
  standalone: true,
  width: 390,
  referrer: 'https://example.com/path',
  extra: {
    amount: 123.45,
    note: 'private dinner',
    category: 'Food',
    tags: ['secret'],
    route: 'list'
  }
});

assert.deepStrictEqual(event, {
  type: 'page_view',
  view: 'dashboard',
  sessionId: 'session-123',
  standalone: true,
  device: 'mobile',
  referrer: 'external'
});

const featureEvent = sanitizeAnalyticsEvent({
  type: 'feature_event',
  view: '<script>',
  sessionId: 'abc',
  feature: 'backup:download-now',
  durationSeconds: 9999
});

assert.deepStrictEqual(featureEvent, {
  type: 'feature_event',
  view: 'add',
  sessionId: 'abc',
  feature: 'backup_download_now'
});

const engagement = sanitizeAnalyticsEvent({
  type: 'engagement',
  view: 'settings',
  sessionId: 'abc',
  durationSeconds: 45.7
});

assert.deepStrictEqual(engagement, {
  type: 'engagement',
  view: 'settings',
  sessionId: 'abc',
  durationSeconds: 46
});

assert.strictEqual(sanitizeAnalyticsEvent({ type: 'unknown', sessionId: 'abc' }), null);
assert.strictEqual(sanitizeAnalyticsEvent({ type: 'page_view', sessionId: '' }), null);

console.log('expense analytics utility tests passed');
