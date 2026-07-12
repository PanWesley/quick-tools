const test = require('node:test');
const assert = require('node:assert/strict');

function loadService() {
  const path = require.resolve('./notification');
  delete require.cache[path];
  return require('./notification');
}

function installBrowserGlobals() {
  const state = new Map([['today-youxu-notification-state', JSON.stringify({ enabled: true })]]);
  global.localStorage = {
    getItem: key => state.get(key) || null,
    setItem: (key, value) => state.set(key, value)
  };
  global.window = {};
  global.document = { hidden: false, visibilityState: 'visible' };
  global.Notification = function Notification() {};
  global.Notification.permission = 'granted';
  global.window.Notification = global.Notification;
}

test('getHabitDateTime accepts only strict HH:mm and defaults invalid values to 09:00', () => {
  const service = loadService();
  const valid = service.getHabitDateTime({ startTime: '07:45' }, '2026-07-11');
  const invalidValues = ['', '7:45', '24:00', '09:60', 'nope'];
  assert.deepEqual([valid.getHours(), valid.getMinutes()], [7, 45]);
  invalidValues.forEach(startTime => {
    const date = service.getHabitDateTime({ startTime }, '2026-07-11');
    assert.deepEqual([date.getHours(), date.getMinutes()], [9, 0]);
  });
});

test('legacy notification copy delegates to NotificationModel approved copy', () => {
  const service = loadService();
  const due = new Date(2026, 6, 11, 10, 30);
  assert.deepEqual(service.buildNotificationCopy('task', { title: '项目周会', area: 'work', startTime: '10:30' }, due, due), {
    title: '项目周会', body: '10:30 · 工作'
  });
});

test('getMissedCount returns a count and never invokes Notification or showNotification', () => {
  installBrowserGlobals();
  let notificationCalls = 0;
  global.Notification = function Notification() { notificationCalls += 1; };
  global.Notification.permission = 'granted';
  global.window.Notification = global.Notification;
  const service = loadService();
  const now = new Date(2026, 6, 11, 10, 0);
  const data = {
    tasks: [{ id: 't1', date: '2026-07-11', status: 'active', startTime: '09:30', reminder: 'at-time' }],
    habits: [{ id: 'h1', status: 'active', startTime: '09:00', reminder: 'at-time' }]
  };
  assert.equal(service.getMissedCount(data, '2026-07-11', () => true, now), 2);
  assert.equal(service.checkMissedReminders(data, '2026-07-11', () => true, now), 2);
  assert.equal(notificationCalls, 0);
});

test('scheduleAll keeps foreground timers within 24 hours', (t) => {
  installBrowserGlobals();
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDate = global.Date;
  const delays = [];
  const fixedNow = new originalDate(2026, 6, 11, 10, 0);
  global.Date = class extends originalDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow.getTime()])); }
    static now() { return fixedNow.getTime(); }
  };
  global.setTimeout = (_callback, delay) => { delays.push(delay); return delays.length; };
  global.clearTimeout = () => {};
  t.after(() => {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.Date = originalDate;
  });

  const service = loadService();
  service.scheduleAll({ tasks: [
    { id: 'within', date: '2026-07-12', status: 'active', startTime: '09:59', reminder: 'at-time' },
    { id: 'beyond', date: '2026-07-12', status: 'active', startTime: '10:01', reminder: 'at-time' }
  ], habits: [] }, '2026-07-11', () => false);

  assert.equal(delays.length, 1);
  assert.ok(delays[0] <= 24 * 60 * 60 * 1000);
});
