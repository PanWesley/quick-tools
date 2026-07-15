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

function loadServiceWithReceipt(receipt) {
  const receiptPath = require.resolve('./notification-receipt');
  const receiptModule = require(receiptPath);
  const original = require.cache[receiptPath].exports;
  require.cache[receiptPath].exports = { create: () => receipt };
  try {
    return loadService();
  } finally {
    require.cache[receiptPath].exports = original || receiptModule;
  }
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

test('scheduleAll never converts an already missed reminder into a two-second catch-up', (t) => {
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
    { id: 'missed', date: '2026-07-11', status: 'active', startTime: '10:15', reminder: '30' }
  ], habits: [] }, '2026-07-11', () => false);

  assert.deepEqual(delays, []);
});

test('a foreground timer waking more than 60 seconds late does not show a stale reminder', async (t) => {
  installBrowserGlobals();
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDate = global.Date;
  const originalNotification = global.Notification;
  const callbacks = [];
  const shown = [];
  let clock = new originalDate(2026, 6, 11, 10, 0).getTime();
  global.Date = class extends originalDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
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

  const service = loadService();
  service.scheduleAll({ tasks: [
    { id: 'late', title: '迟到计时器', date: '2026-07-11', status: 'active', startTime: '10:01', reminder: 'at-time' }
  ], habits: [] }, '2026-07-11', () => false);
  assert.equal(callbacks.length, 1);
  clock = new originalDate(2026, 6, 11, 10, 2, 1).getTime();
  await callbacks[0]();
  assert.equal(shown.length, 0);
});

test('foreground delivery skips background receipts and visible system notifications', async (t) => {
  installBrowserGlobals();
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const callbacks = [];
  let shown = 0;
  global.setTimeout = callback => { callbacks.push(callback); return callbacks.length; };
  global.clearTimeout = () => {};
  global.Notification = function Notification() { shown += 1; };
  global.Notification.permission = 'granted';
  global.window.Notification = global.Notification;
  t.after(() => {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  });

  const receipt = { has: async () => true, record: async () => true };
  const service = loadServiceWithReceipt(receipt);
  service.scheduleAll({ tasks: [
    { id: 'delivered', title: '已后台送达', date: '2099-01-01', status: 'active', startTime: '10:00', reminder: 'at-time' }
  ], habits: [] }, '2099-01-01', () => false);
  // Use the direct hook to avoid coupling this assertion to the 24-hour scheduling window.
  await service.fireNotification('task', { id: 'delivered', title: '已后台送达', date: '2099-01-01' }, new Date(), new Date());
  assert.equal(shown, 0);

  const visibleService = loadServiceWithReceipt({ has: async () => false, record: async () => true });
  visibleService.setServiceWorkerRegistration({
    async getNotifications() { return [{ tag: 'visible' }]; },
    async showNotification() { shown += 1; }
  });
  await visibleService.fireNotification('task', { id: 'visible', title: '系统中可见', date: '2099-01-01' }, new Date(), new Date());
  assert.equal(shown, 0);
});

test('successful foreground delivery records the shared notification receipt', async (t) => {
  installBrowserGlobals();
  const originalNotification = global.Notification;
  const recorded = [];
  global.Notification = function Notification() {};
  global.Notification.permission = 'granted';
  global.window.Notification = global.Notification;
  t.after(() => {
    global.Notification = originalNotification;
    global.window.Notification = originalNotification;
  });

  const service = loadServiceWithReceipt({
    has: async () => false,
    async record(tag, scheduledAt) { recorded.push([tag, scheduledAt]); return true; }
  });
  const notifyTime = new Date();
  const dueTime = new Date(notifyTime.getTime() + 5 * 60 * 1000);
  await service.fireNotification('task', {
    id: 'foreground', title: '前台提醒', date: '2026-07-11', startTime: '10:00'
  }, notifyTime, dueTime);

  const model = require('./notification-model');
  assert.deepEqual(recorded, [[
    model.buildNotificationTag('task', 'foreground', dueTime),
    notifyTime.getTime()
  ]]);
});

test('foreground delivery rechecks the 60-second grace after asynchronous deduplication', async (t) => {
  installBrowserGlobals();
  const originalDate = global.Date;
  const originalNotification = global.Notification;
  let shown = 0;
  let clock = new originalDate(2026, 6, 11, 10, 0).getTime();
  global.Date = class extends originalDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  global.Notification = function Notification() { shown += 1; };
  global.Notification.permission = 'granted';
  global.window.Notification = global.Notification;
  t.after(() => {
    global.Date = originalDate;
    global.Notification = originalNotification;
    global.window.Notification = originalNotification;
  });

  const service = loadServiceWithReceipt({
    async has() {
      clock += 61 * 1000;
      return false;
    },
    record: async () => true
  });
  const notifyTime = new global.Date(clock);
  await service.fireNotification('task', {
    id: 'slow-dedup', title: '延迟检查', date: '2026-07-11'
  }, notifyTime, new global.Date(clock + 5 * 60 * 1000));

  assert.equal(shown, 0);
});

test('foreground notification startup clears expired shared receipts', async () => {
  let cleanupCalls = 0;
  loadServiceWithReceipt({
    async clearExpired() { cleanupCalls += 1; return true; },
    has: async () => false,
    record: async () => true
  });
  await Promise.resolve();
  assert.equal(cleanupCalls, 1);
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
  await callbacks[0]();

  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.tag, records[0].encryptedValue.tag);
  assert.equal(shown[0].options.tag, model.buildNotificationTag('task', item.id, new Date(2026, 6, 11, 10, 0)));
  assert.equal(shown[0].options.renotify, false);
});

test('initSW keeps registration setup without owning service worker messages', () => {
  assert.match(notificationSource, /navigator\.serviceWorker\.ready\.then/);
  assert.doesNotMatch(notificationSource, /serviceWorker\.addEventListener\(['"]message['"]/);
});
