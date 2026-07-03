const assert = require('assert');

const {
  createAnalyticsEvent,
  getAnalyticsRoute,
  getDeviceClass,
  getSiteToolFromPathname,
  getSiteViewFromLocation,
  sanitizeAnalyticsEvent
} = require('./site-analytics-utils');

assert.strictEqual(getSiteToolFromPathname('/'), 'home');
assert.strictEqual(getSiteToolFromPathname('/index.html'), 'home');
assert.strictEqual(getSiteToolFromPathname('/tools/diff/'), 'diff');
assert.strictEqual(getSiteToolFromPathname('/tools/json/index.html'), 'json');
assert.strictEqual(getSiteToolFromPathname('/tools/expense/'), 'expense');
assert.strictEqual(getSiteToolFromPathname('/tools/time/'), 'time');
assert.strictEqual(getSiteToolFromPathname('/tools/price/'), 'price');
assert.strictEqual(getSiteToolFromPathname('/something-else/'), 'unknown');

assert.strictEqual(getSiteViewFromLocation('/tools/expense/', '#view=dashboard'), 'dashboard');
assert.strictEqual(getSiteViewFromLocation('/tools/expense/', '#view=list&tag=abc'), 'list');
assert.strictEqual(getSiteViewFromLocation('/tools/diff/', ''), 'main');
assert.strictEqual(getSiteViewFromLocation('/', ''), 'home');

assert.strictEqual(getAnalyticsRoute('/tools/expense/', '#view=dashboard'), '/tools/expense/#view=dashboard');
assert.strictEqual(getAnalyticsRoute('/tools/json/index.html', ''), '/tools/json/');
assert.strictEqual(getAnalyticsRoute('/tools/diff/', '#ignored'), '/tools/diff/');
assert.strictEqual(getAnalyticsRoute('/tools/price/', '#ignored'), '/tools/price/');
assert.strictEqual(getAnalyticsRoute('/index.html', ''), '/');

assert.strictEqual(getDeviceClass(390), 'mobile');
assert.strictEqual(getDeviceClass(900), 'tablet');
assert.strictEqual(getDeviceClass(1280), 'desktop');

const event = createAnalyticsEvent({
  type: 'page_view',
  pathname: '/tools/expense/',
  hash: '#view=dashboard',
  sessionId: 'session-1',
  standalone: true,
  width: 390,
  referrer: 'https://example.com/path',
  origin: 'https://www.billnest.top',
  amount: 88,
  note: 'private note',
  category: 'Food',
  tags: ['secret']
});

assert.deepStrictEqual(event, {
  type: 'page_view',
  tool: 'expense',
  route: '/tools/expense/#view=dashboard',
  view: 'dashboard',
  sessionId: 'session-1',
  standalone: true,
  device: 'mobile',
  referrer: 'external'
});

assert.ok(!Object.prototype.hasOwnProperty.call(event, 'amount'));
assert.ok(!Object.prototype.hasOwnProperty.call(event, 'note'));
assert.ok(!Object.prototype.hasOwnProperty.call(event, 'category'));
assert.ok(!Object.prototype.hasOwnProperty.call(event, 'tags'));

const priceEvent = createAnalyticsEvent({
  type: 'page_view',
  pathname: '/tools/price/',
  hash: '#ignored',
  sessionId: 'session-2',
  standalone: false,
  width: 1280,
  referrer: '',
  origin: 'https://www.billnest.top'
});

assert.strictEqual(priceEvent.tool, 'price');
assert.strictEqual(priceEvent.route, '/tools/price/');
assert.strictEqual(priceEvent.view, 'main');

assert.deepStrictEqual(sanitizeAnalyticsEvent({
  type: 'feature_event',
  tool: 'time',
  route: '/tools/time/',
  view: 'main',
  sessionId: 'abc',
  feature: 'Habit Done!'
}), {
  type: 'feature_event',
  tool: 'time',
  route: '/tools/time/',
  view: 'main',
  sessionId: 'abc',
  feature: 'habit_done'
});

assert.strictEqual(sanitizeAnalyticsEvent({
  type: 'page_view',
  tool: 'bad tool',
  route: '/tools/time/',
  view: 'main',
  sessionId: 'abc'
}), null);

assert.strictEqual(sanitizeAnalyticsEvent({
  type: 'bad_event',
  tool: 'time',
  route: '/tools/time/',
  view: 'main',
  sessionId: 'abc'
}), null);

console.log('site analytics utility tests passed');
