const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

function scriptPosition(name) {
  return index.indexOf('/tools/time/js/' + name + '?v=');
}

function createHarness(overrides = {}) {
  const listeners = { document: {}, window: {} };
  const elements = new Map();
  const makeElement = id => ({
    id,
    hidden: false,
    textContent: '',
    className: '',
    value: '',
    checked: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    querySelectorAll() { return []; },
    setAttribute() {},
    focus() {},
    reset() {}
  });
  const document = {
    hidden: false,
    visibilityState: 'visible',
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(type, callback) { listeners.document[type] = callback; },
    createElement() { return makeElement('created'); },
    documentElement: { dataset: {}, setAttribute() {}, getAttribute() { return ''; } }
  };
  const notification = overrides.Notification || {
    permission: 'default',
    requestPermission: async () => 'granted'
  };
  const legacy = overrides.legacy || {
    getPermissionStatus: () => notification.permission,
    isEnabled: () => notification.permission === 'granted',
    setEnabled() {},
    scheduleAll() {},
    getMissedCount: () => 0,
    setServiceWorkerRegistration() {},
    initSW() {},
    startPeriodicCheck() {},
    setPermissionChangeCallback() {}
  };
  const db = overrides.db || { getAllData: async () => ({ tasks: [], habits: [], habitLogs: [] }) };
  const syncFactory = overrides.syncFactory || { create: () => overrides.sync };
  const window = {
    TodayYouxuDateUtils: { getTodayKey: () => '2026-07-12' },
    TodayYouxuState: { habitDueOn: () => false },
    TodayYouxuExport: {},
    TodayYouxuDB: db,
    TodayYouxuNotification: legacy,
    TodayYouxuNotificationModel: overrides.model || { buildReminderRecords: async () => [] },
    TodayYouxuNotificationSync: syncFactory,
    Notification: notification,
    navigator: overrides.navigator || {},
    location: { hash: '' },
    addEventListener(type, callback) { listeners.window[type] = callback; },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    confirm: () => true,
    open() {}
  };
  window.window = window;
  const source = appSource.replace('      render();\n', '').replace(
    "document.addEventListener('DOMContentLoaded', init);",
    `window.__notificationTestHooks = {
      handleNotificationAction: handleNotificationAction,
      loadData: loadData,
      registerServiceWorker: registerServiceWorker,
      recoverNotificationOnline: recoverNotificationOnline,
      recoverNotificationForeground: recoverNotificationForeground,
      queueNotificationSync: queueNotificationSync,
      setNotificationBackendStatus: setNotificationBackendStatus,
      setNotificationSync: function(value) { NotificationSync = value; },
      setAppData: function(value) { appState.data = value; },
      getNotificationBackendStatus: function() { return notificationBackendStatus; },
      setElements: function() {
        els.toast = document.getElementById('toast');
        els.notificationStatus = document.getElementById('notification-status');
        els.notificationDesc = document.getElementById('notification-desc');
        els.notificationButton = document.getElementById('notification-setup-button');
      }
    };`
  );
  const context = {
    window,
    document,
    navigator: window.navigator,
    Notification: notification,
    localStorage: { getItem: () => null, setItem() {} },
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval,
    URL,
    Blob: globalThis.Blob,
    FileReader: class {},
    Date,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    JSON,
    encodeURIComponent
  };
  vm.runInNewContext(source, context, { filename: 'app.js' });
  window.__notificationTestHooks.setElements();
  return { hooks: window.__notificationTestHooks, listeners, window, document, elements };
}

test('loads cache-busted notification dependencies in strict order', () => {
  const names = [
    'notification-crypto.js',
    'notification-model.js',
    'notification-sync.js',
    'notification.js',
    'app.js'
  ];
  names.forEach(name => assert.notEqual(scriptPosition(name), -1, name + ' must be cache-busted'));
  names.slice(1).forEach((name, index) => {
    assert.ok(scriptPosition(names[index]) < scriptPosition(name), names[index] + ' must load before ' + name);
  });
});

test('projects encrypted reminder records and preserves the exact sync call', () => {
  assert.match(appSource, /NotificationModel\.buildReminderRecords\(data, appState\.todayKey, State\.habitDueOn, new Date\(\)\)/);
  assert.match(appSource, /payload:\s*record\.encryptedValue/);
  assert.match(appSource, /NotificationSync\.sync\(data, appState\.todayKey, State\.habitDueOn\)/);
});

test('permission can only be requested from the notification click handler', () => {
  const matches = [...appSource.matchAll(/Notification\.requestPermission\(\)/g)];
  const handlerStart = appSource.indexOf('function handleNotificationAction()');
  const handlerEnd = appSource.indexOf('\n  function ', handlerStart + 1);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].index > handlerStart && matches[0].index < handlerEnd);
});

test('does not use legacy missed notifications or plaintext backend fields', () => {
  assert.doesNotMatch(appSource, /checkMissedReminders\(/);
  assert.match(appSource, /NotificationService\.getMissedCount\(/);
  assert.doesNotMatch(appSource, /deviceToken/);
  const integration = appSource.match(/var NotificationModel[\s\S]*?function normalizePriority/);
  assert.ok(integration);
  assert.doesNotMatch(integration[0], /localStorage/);
  assert.doesNotMatch(appSource, /sendTest\(\s*\{|sendTest\([^)]*title/);
});

test('declares short typed status copy and restrained CSS states', () => {
  const copy = {
    subscribing: '正在连接',
    syncing: '正在连接',
    pending: '等待同步',
    ready: '后台提醒已开启',
    error: '需要重新授权',
    unsupported: '当前设备不支持',
    'permission-required': '未开启',
    disabled: '未开启'
  };
  Object.entries(copy).forEach(([status, label]) => {
    assert.match(appSource, new RegExp("['\"]" + status + "['\"]\\s*:\\s*['\"]" + label + "['\"]"));
  });
  ['syncing', 'pending', 'error'].forEach(status => {
    assert.match(css, new RegExp('\\.notification-status-' + status + '\\b'));
  });
});

test('notification backend failure cannot reject the core refresh', async () => {
  const sync = {
    getStatus: async () => ({ status: 'ready' }),
    sync: async () => { throw new Error('backend unavailable'); }
  };
  const harness = createHarness({ sync });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });
  await assert.doesNotReject(harness.hooks.loadData());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'error');
});

test('ready click sends only the encrypted backend test', async () => {
  let sent = 0;
  let legacyScheduled = 0;
  const sync = {
    getStatus: async () => ({ status: 'ready' }),
    sendTest: async () => { sent += 1; return { status: 'ready' }; }
  };
  const harness = createHarness({
    sync,
    legacy: {
      getPermissionStatus: () => 'granted',
      isEnabled: () => true,
      setEnabled() {},
      scheduleAll() { legacyScheduled += 1; },
      getMissedCount: () => 0
    }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });
  await harness.hooks.handleNotificationAction();
  assert.equal(sent, 1);
  assert.equal(legacyScheduled, 0);
});

test('permission request remains inside the runtime click path', async () => {
  let requested = 0;
  const notification = {
    permission: 'default',
    requestPermission: async () => { requested += 1; notification.permission = 'granted'; return 'granted'; }
  };
  const sync = {
    enable: async () => ({ status: 'pending' }),
    sync: async () => ({ status: 'ready' }),
    sendTest: async () => ({ status: 'ready' })
  };
  const harness = createHarness({ Notification: notification, sync });
  harness.hooks.setNotificationSync(sync);
  assert.equal(requested, 0);
  await harness.hooks.handleNotificationAction();
  assert.equal(requested, 1);
});

test('schedules the current reminders before a backend enable failure', async () => {
  const scheduled = [];
  const notification = {
    permission: 'default',
    requestPermission: async () => {
      notification.permission = 'granted';
      return 'granted';
    }
  };
  const sync = { enable: async () => { throw new Error('backend unavailable'); } };
  const harness = createHarness({
    Notification: notification,
    sync,
    legacy: {
      getPermissionStatus: () => notification.permission,
      setEnabled() {},
      scheduleAll(data, todayKey, habitDueOn) { scheduled.push({ data, todayKey, habitDueOn }); },
      getMissedCount: () => 0
    }
  });
  const data = { marker: 'current snapshot' };
  harness.hooks.setAppData(data);
  harness.hooks.setNotificationSync(sync);

  await harness.hooks.handleNotificationAction();

  assert.deepEqual(scheduled.map(call => call.data), [data]);
  assert.equal(scheduled[0].todayKey, '2026-07-12');
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'error');
});

test('online and foreground recovery drain then refetch and sync', async () => {
  const calls = [];
  const sync = {
    handleOnline: async () => { calls.push('online'); return { status: 'ready' }; },
    handleForeground: async () => { calls.push('foreground'); return { status: 'ready' }; },
    sync: async () => { calls.push('sync'); return { status: 'ready' }; }
  };
  const db = { getAllData: async () => { calls.push('getAllData'); return { tasks: [], habits: [], habitLogs: [] }; } };
  const harness = createHarness({ sync, db });
  harness.hooks.setNotificationSync(sync);
  await harness.hooks.recoverNotificationOnline();
  assert.deepEqual(calls, ['online', 'getAllData', 'sync']);
  calls.length = 0;
  await harness.hooks.recoverNotificationForeground();
  assert.deepEqual(calls, ['foreground', 'getAllData', 'sync']);
});

test('local recovery reads do not replace a ready backend status with authorization copy', async () => {
  const calls = [];
  const sync = {
    handleOnline: async () => { calls.push('online'); return { status: 'ready' }; },
    handleForeground: async () => { calls.push('foreground'); return { status: 'ready' }; }
  };
  const db = {
    getAllData: async () => {
      calls.push('getAllData');
      throw new Error('indexeddb unavailable');
    }
  };
  const harness = createHarness({ sync, db });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });

  await harness.hooks.recoverNotificationOnline();
  await harness.hooks.recoverNotificationForeground();

  assert.deepEqual(calls, ['online', 'getAllData', 'foreground', 'getAllData']);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
  assert.match(harness.elements.get('toast').textContent, /^本地数据库读取失败：indexeddb unavailable$/);
});

test('backend lifecycle recovery failures still reach the backend failure handler', async () => {
  const sync = { handleOnline: async () => { throw new Error('backend unavailable'); } };
  const harness = createHarness({ sync });
  harness.hooks.setNotificationSync(sync);

  await assert.rejects(harness.hooks.recoverNotificationOnline(), /backend unavailable/);
});

test('waits for service worker ready, shares one setup promise, and disables early notification clicks', async () => {
  let resolveRegister;
  let resolveReady;
  const registered = new Promise(resolve => { resolveRegister = resolve; });
  const ready = new Promise(resolve => { resolveReady = resolve; });
  let creates = 0;
  let setupCalls = 0;
  let setupRegistration = null;
  let serviceRegistration = null;
  let registerCalls = 0;
  const registration = { source: 'register' };
  const readyRegistration = { source: 'ready' };
  const sync = {
    setup: async reg => {
      setupCalls += 1;
      setupRegistration = reg;
      return { status: 'ready' };
    },
    sync: async () => ({ status: 'ready' })
  };
  const navigator = {
    serviceWorker: {
      register() { registerCalls += 1; return registered; },
      ready
    }
  };
  const harness = createHarness({
    sync,
    navigator,
    syncFactory: { create() { creates += 1; return sync; } },
    legacy: {
      getPermissionStatus: () => 'default',
      setServiceWorkerRegistration(reg) { serviceRegistration = reg; },
      scheduleAll() {},
      getMissedCount: () => 0
    }
  });
  const first = harness.hooks.registerServiceWorker();
  const second = harness.hooks.registerServiceWorker();

  assert.strictEqual(first, second);
  assert.equal(registerCalls, 1);
  assert.equal(creates, 0);
  assert.equal(harness.elements.get('notification-setup-button').disabled, true);
  assert.equal(harness.elements.get('notification-status').textContent, '正在连接');

  resolveRegister(registration);
  await Promise.resolve();
  assert.equal(creates, 0);

  resolveReady(readyRegistration);
  await first;
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(creates, 1);
  assert.equal(setupCalls, 1);
  assert.strictEqual(setupRegistration, readyRegistration);
  assert.strictEqual(serviceRegistration, readyRegistration);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
  assert.equal(harness.elements.get('notification-setup-button').disabled, false);
});

test('successful setup projects the current snapshot missed before registration', async () => {
  let synced = 0;
  const registration = {};
  const sync = {
    setup: async () => ({ status: 'ready' }),
    sync: async () => { synced += 1; return { status: 'ready' }; }
  };
  const navigator = { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } };
  const harness = createHarness({ sync, navigator });
  await harness.hooks.registerServiceWorker();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(synced, 1);
});

test('coalesces concurrent projections to the latest snapshot', async () => {
  const projected = [];
  const synced = [];
  let releaseFirst;
  let active = 0;
  let maxActive = 0;
  const model = {
    buildReminderRecords: async data => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      projected.push(data.marker);
      if (data.marker === 'first') await new Promise(resolve => { releaseFirst = resolve; });
      active -= 1;
      return [];
    }
  };
  const sync = {
    sync: async data => { synced.push(data.marker); return { status: 'ready' }; }
  };
  const harness = createHarness({ model, sync });
  harness.hooks.setNotificationSync(sync);
  const first = harness.hooks.queueNotificationSync({ marker: 'first' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const middle = harness.hooks.queueNotificationSync({ marker: 'middle' });
  const latest = harness.hooks.queueNotificationSync({ marker: 'latest' });
  releaseFirst();
  await Promise.all([first, middle, latest]);
  assert.equal(maxActive, 1);
  assert.deepEqual(projected, ['first', 'latest']);
  assert.deepEqual(synced, ['first', 'latest']);
});
