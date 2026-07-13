const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const notificationSource = fs.readFileSync(path.join(__dirname, 'notification.js'), 'utf8');

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

test('foreground timer and encrypted push payload use the same notification tag without renotify', async (t) => {
  installBrowserGlobals();
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDate = global.Date;
  const originalNotification = global.Notification;
  const callbacks = [];
  const shown = [];
  const fixedNow = new originalDate(2026, 6, 11, 9, 59);
  global.Date = class extends originalDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow.getTime()])); }
    static now() { return fixedNow.getTime(); }
  };
  global.setTimeout = callback => { callbacks.push(callback); return callbacks.length; };
  global.clearTimeout = () => {};
  global.Notification = function Notification(title, options) { shown.push({ title, options }); };
  global.Notification.permission = 'granted';
  global.window.Notification = global.Notification;
  t.after(() => {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.Date = originalDate;
    global.Notification = originalNotification;
    global.window.Notification = originalNotification;
  });

  const item = {
    id: 'task-shared-tag', title: '项目周会', date: '2026-07-11', area: 'work',
    status: 'active', startTime: '10:00', reminder: 'at-time',
    updatedAt: '2026-07-01T00:00:00.000Z'
  };
  const model = require('./notification-model');
  const records = await model.buildReminderRecords(
    { tasks: [item], habits: [], habitLogs: [] },
    '2026-07-11',
    () => false,
    fixedNow
  );
  const service = loadService();
  service.scheduleAll({ tasks: [item], habits: [] }, '2026-07-11', () => false);
  assert.equal(typeof model.buildNotificationTag, 'function');
  assert.equal(callbacks.length, 1);
  callbacks[0]();
  await Promise.resolve();

  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.tag, records[0].encryptedValue.tag);
  assert.equal(shown[0].options.tag, model.buildNotificationTag('task', item.id, new Date(2026, 6, 11, 10, 0)));
  assert.equal(shown[0].options.renotify, false);
});

test('initSW keeps registration setup without owning service worker messages', () => {
  assert.match(notificationSource, /navigator\.serviceWorker\.ready\.then/);
  assert.doesNotMatch(notificationSource, /serviceWorker\.addEventListener\(['"]message['"]/);
});
