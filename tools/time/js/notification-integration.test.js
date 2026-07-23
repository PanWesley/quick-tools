const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const quickEditor = require('./quick-editor-state.js');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

function scriptPosition(name) {
  return index.indexOf('/tools/time/js/' + name + '?v=');
}

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimeout(callback, delay) {
    const id = nextId++;
    timers.set(id, { callback, dueAt: now + Math.max(0, Number(delay) || 0) });
    return id;
  }

  function clearTimeout(id) {
    timers.delete(id);
  }

  function advance(milliseconds) {
    now += milliseconds;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!next) return;
      timers.delete(next[0]);
      next[1].callback();
    }
  }

  return { setTimeout, clearTimeout, advance, count: () => timers.size };
}

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
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
    documentElement: { dataset: {}, setAttribute() {}, getAttribute() { return ''; } },
    body: { style: {}, classList: { add() {}, remove() {} }, setAttribute() {} }
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
  const timers = overrides.timers || { setTimeout, clearTimeout };
  const window = {
    TodayYouxuDateUtils: { getTodayKey: () => '2026-07-12' },
    TodayYouxuState: { habitDueOn: () => false },
    TodayYouxuExport: {},
    TodayYouxuDB: db,
    TodayYouxuNotification: legacy,
    TodayYouxuNotificationModel: overrides.model || { buildReminderRecords: async () => [] },
    TodayYouxuNotificationSync: syncFactory,
    TodayYouxuQuickEditor: quickEditor,
    Notification: notification,
    navigator: overrides.navigator || {},
    location: { hash: '' },
    addEventListener(type, callback) { listeners.window[type] = callback; },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    confirm: () => true,
    open() {}
  };
  window.window = window;
  const source = appSource.replace('      render();\n      updateNotificationUI();', '      updateNotificationUI();').replace(
    "document.addEventListener('DOMContentLoaded', init);",
    `window.__notificationTestHooks = {
      handleNotificationAction: handleNotificationAction,
      handleNotificationDisable: typeof handleNotificationDisable === 'function' ? handleNotificationDisable : null,
      loadData: loadData,
      registerServiceWorker: registerServiceWorker,
      recoverNotificationOnline: recoverNotificationOnline,
      recoverNotificationForeground: recoverNotificationForeground,
      cacheElements: cacheElements,
      bindEvents: bindEvents,
      queueNotificationSync: queueNotificationSync,
      setNotificationBackendStatus: setNotificationBackendStatus,
      setNotificationSync: function(value) {
        NotificationSync = value;
        notificationSetupState = value ? 'complete' : 'idle';
      },
      setAppData: function(value) { appState.data = value; },
      getNotificationBackendStatus: function() { return notificationBackendStatus; },
      setElements: function() {
        els.toast = document.getElementById('toast');
        els.notificationStatus = document.getElementById('notification-status');
        els.notificationDesc = document.getElementById('notification-desc');
        els.notificationButton = document.getElementById('notification-setup-button');
        els.notificationDisableButton = document.getElementById('notification-disable-button');
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
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
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
  return { hooks: window.__notificationTestHooks, listeners, window, document, elements, timers };
}

test('loads cache-busted notification dependencies in strict order', () => {
  const names = [
    'notification-crypto.js',
    'notification-receipt.js',
    'notification-model.js',
    'notification-sync.js',
    'notification.js',
    'quick-editor-state.js',
    'app.js'
  ];
  names.forEach(name => assert.notEqual(scriptPosition(name), -1, name + ' must be cache-busted'));
  names.slice(1).forEach((name, index) => {
    assert.ok(scriptPosition(names[index]) < scriptPosition(name), names[index] + ' must load before ' + name);
  });
  const releaseAssets = [
    '/tools/time/css/style.css?v=160',
    '/tools/time/js/quick-editor-state.js?v=2',
    '/tools/time/js/notification-crypto.js?v=2',
    '/tools/time/js/notification-receipt.js?v=1',
    '/tools/time/js/notification-model.js?v=2',
    '/tools/time/js/notification-sync.js?v=5',
    '/tools/time/js/notification.js?v=7',
    '/tools/time/js/app.js?v=163'
  ];
  const releaseAssetPaths = new Set(releaseAssets.map(asset => asset.split('?')[0]));
  const indexedReleaseAssets = [...index.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(asset => releaseAssetPaths.has(asset.split('?')[0]));
  assert.deepEqual(indexedReleaseAssets.slice().sort(), releaseAssets.slice().sort());
  assert.match(appSource, /var APP_VERSION = 'v0\.10\.0';/);
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
    pending: '等待网络恢复',
    ready: '后台提醒已开启',
    error: '提醒连接失败',
    unsupported: '当前设备不支持',
    'permission-required': '未开启通知',
    'permission-denied': '请在系统设置中开启通知',
    'reauthorization-required': '提醒连接已失效',
    disabled: '未开启'
  };
  Object.entries(copy).forEach(([status, label]) => {
    assert.match(appSource, new RegExp("['\"]" + status + "['\"]\\s*:\\s*['\"]" + label + "['\"]"));
  });
  ['syncing', 'pending', 'error', 'permission-denied', 'reauthorization-required'].forEach(status => {
    assert.match(css, new RegExp('\\.notification-status-' + status + '\\b'));
  });
});

test('notification states expose concise matching actions', () => {
  const notification = { permission: 'granted', requestPermission: async () => 'granted' };
  const harness = createHarness({ Notification: notification, sync: {} });
  const button = harness.elements.get('notification-setup-button');
  const status = harness.elements.get('notification-status');
  const cases = [
    ['reauthorization-required', '提醒连接已失效', '重新连接'],
    ['pending', '等待网络恢复', '重试'],
    ['error', '提醒连接失败', '重试'],
    ['ready', '后台提醒已开启', '测试提醒']
  ];

  cases.forEach(([state, label, action]) => {
    harness.hooks.setNotificationBackendStatus({ status: state });
    assert.equal(status.textContent, label);
    assert.equal(button.textContent, action);
  });

  notification.permission = 'default';
  harness.hooks.setNotificationBackendStatus({ status: 'permission-required' });
  assert.equal(status.textContent, '未开启通知');
  assert.equal(button.textContent, '开启通知');
});

test('denied permission shows settings guidance without requesting permission again', async () => {
  let permissionRequests = 0;
  const notification = {
    permission: 'denied',
    requestPermission: async () => { permissionRequests += 1; return 'denied'; }
  };
  const harness = createHarness({ Notification: notification, sync: {} });
  harness.hooks.setNotificationSync({});
  harness.hooks.setNotificationBackendStatus({ status: 'permission-denied' });

  assert.equal(harness.elements.get('notification-status').textContent, '请在系统设置中开启通知');
  assert.equal(harness.elements.get('notification-setup-button').textContent, '查看说明');
  await harness.hooks.handleNotificationAction();

  assert.equal(permissionRequests, 0);
  assert.equal(harness.elements.get('toast').textContent, 'iPhone 设置 > App > 今日有序 > 通知');
});

test('explicit credential reconnect publishes repairing progress and enables once', async () => {
  let resolveEnable;
  let enableCalls = 0;
  const enabling = new Promise(resolve => { resolveEnable = resolve; });
  const sync = {
    enable() { enableCalls += 1; return enabling; },
    sync: async () => ({ status: 'ready' }),
    sendTest: async () => ({ status: 'ready' })
  };
  const harness = createHarness({
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    sync
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'reauthorization-required' });

  const action = harness.hooks.handleNotificationAction();
  await settle();
  assert.equal(enableCalls, 1);
  assert.equal(harness.elements.get('notification-status').textContent, '正在重新连接');
  assert.equal(harness.elements.get('notification-setup-button').disabled, true);

  resolveEnable({ status: 'ready' });
  await action;
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
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

test('a failed test notification settles outside the subscription state', async () => {
  const sync = {
    sendTest: async () => ({ status: 'pending' })
  };
  const harness = createHarness({
    sync,
    Notification: { permission: 'granted', requestPermission: async () => 'granted' }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'ready', deviceId: 'device-1' });

  await harness.hooks.handleNotificationAction();

  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'pending');
  assert.notEqual(harness.hooks.getNotificationBackendStatus().status, 'disabled');
  assert.notEqual(harness.hooks.getNotificationBackendStatus().status, 'syncing');
});

test('ready notification row keeps test reminder and offers inline disable with pending state', async () => {
  let disables = 0;
  const localEnabled = [];
  const sync = {
    disable: async () => {
      disables += 1;
      return { status: 'pending', deviceId: 'device-1' };
    }
  };
  const harness = createHarness({
    sync,
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    legacy: {
      getPermissionStatus: () => 'granted',
      setEnabled(value) { localEnabled.push(value); },
      scheduleAll() {},
      getMissedCount: () => 0
    }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });

  assert.match(index, /id="notification-disable-button"[^>]+data-action="notification-disable"[^>]*>关闭<\/button>/);
  assert.equal(typeof harness.hooks.handleNotificationDisable, 'function');
  assert.equal(harness.elements.get('notification-setup-button').textContent, '测试提醒');
  assert.equal(harness.elements.get('notification-disable-button').hidden, false);

  await harness.hooks.handleNotificationDisable();

  assert.equal(disables, 1);
  assert.deepEqual(localEnabled, [false]);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'pending');
  assert.equal(harness.elements.get('notification-status').textContent, '等待网络恢复');
  assert.equal(harness.elements.get('notification-disable-button').hidden, true);
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

test('foreground credential recovery publishes ready only after reminder sync completes', async () => {
  let resolveData;
  let resolveSync;
  const loadingData = new Promise(resolve => { resolveData = resolve; });
  const syncing = new Promise(resolve => { resolveSync = resolve; });
  const sync = {
    handleForeground: async () => ({ status: 'ready' }),
    sync: () => syncing
  };
  const harness = createHarness({
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    sync,
    db: { getAllData: () => loadingData }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'reauthorization-required' });

  const recovery = harness.hooks.recoverNotificationForeground();
  await settle();
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'syncing');
  assert.equal(harness.elements.get('notification-status').textContent, '正在重新连接');

  resolveData({ tasks: [], habits: [], habitLogs: [] });
  await settle();
  resolveSync({ status: 'ready' });
  await recovery;
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
  assert.equal(harness.elements.get('notification-status').textContent, '后台提醒已开启');
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

test('service worker ready deadline schedules one automatic setup retry', async () => {
  const timers = createFakeTimers();
  const registration = { source: 'register' };
  const readyRegistration = { source: 'ready' };
  let ready = new Promise(() => {});
  let registerCalls = 0;
  let setupCalls = 0;
  const sync = {
    setup: async () => {
      setupCalls += 1;
      return { status: 'ready' };
    },
    sync: async () => ({ status: 'ready' })
  };
  const harness = createHarness({
    timers,
    sync,
    navigator: {
      serviceWorker: {
        register: async () => {
          registerCalls += 1;
          return registration;
        },
        get ready() { return ready; }
      }
    }
  });

  const first = harness.hooks.registerServiceWorker();
  let firstResult;
  first.then(result => { firstResult = result; });
  await settle();
  timers.advance(10000);
  await settle();

  assert.equal(firstResult.status, 'pending');
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'pending');
  assert.equal(harness.elements.get('notification-setup-button').disabled, false);
  assert.equal(timers.count(), 1);

  ready = Promise.resolve(readyRegistration);
  timers.advance(250);
  await settle();

  assert.equal(registerCalls, 1);
  assert.equal(setupCalls, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
});

test('register rejection releases setup ownership for an explicit retry', async () => {
  let registerCalls = 0;
  let setupCalls = 0;
  const registration = {};
  const sync = {
    setup: async () => {
      setupCalls += 1;
      return { status: 'ready' };
    },
    sync: async () => ({ status: 'ready' })
  };
  const harness = createHarness({
    sync,
    navigator: {
      serviceWorker: {
        register: async () => {
          registerCalls += 1;
          if (registerCalls === 1) throw new Error('register unavailable');
          return registration;
        },
        ready: Promise.resolve(registration)
      }
    }
  });

  await harness.hooks.registerServiceWorker();
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'error');

  await harness.hooks.registerServiceWorker();
  await settle();

  assert.equal(registerCalls, 2);
  assert.equal(setupCalls, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
});

test('synchronous register failure releases setup ownership for retry', async () => {
  let registerCalls = 0;
  let setupCalls = 0;
  const registration = {};
  const sync = {
    setup: async () => {
      setupCalls += 1;
      return { status: 'ready' };
    },
    sync: async () => ({ status: 'ready' })
  };
  const harness = createHarness({
    sync,
    navigator: {
      serviceWorker: {
        register() {
          registerCalls += 1;
          if (registerCalls === 1) throw new Error('register threw');
          return Promise.resolve(registration);
        },
        ready: Promise.resolve(registration)
      }
    }
  });

  await harness.hooks.registerServiceWorker();
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'error');

  await harness.hooks.registerServiceWorker();
  await settle();

  assert.equal(registerCalls, 2);
  assert.equal(setupCalls, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
});

test('service worker ready rejection retries without registering again', async () => {
  let registerCalls = 0;
  let readyCalls = 0;
  let setupCalls = 0;
  const registration = {};
  const sync = {
    setup: async () => {
      setupCalls += 1;
      return { status: 'ready' };
    },
    sync: async () => ({ status: 'ready' })
  };
  const harness = createHarness({
    sync,
    navigator: {
      serviceWorker: {
        register: async () => {
          registerCalls += 1;
          return registration;
        },
        get ready() {
          readyCalls += 1;
          return readyCalls === 1
            ? Promise.reject(new Error('ready unavailable'))
            : Promise.resolve(registration);
        }
      }
    }
  });

  await harness.hooks.registerServiceWorker();
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'error');

  await harness.hooks.registerServiceWorker();
  await settle();

  assert.equal(registerCalls, 1);
  assert.equal(readyCalls, 2);
  assert.equal(setupCalls, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
});

test('setup rejection releases ownership so online recovery retries setup', async () => {
  let registerCalls = 0;
  let setupCalls = 0;
  const registration = {};
  const sync = {
    setup: async () => {
      setupCalls += 1;
      if (setupCalls === 1) throw new Error('setup unavailable');
      return { status: 'ready' };
    },
    handleOnline: async () => ({ status: 'ready' }),
    sync: async () => ({ status: 'ready' })
  };
  const harness = createHarness({
    sync,
    navigator: {
      onLine: true,
      serviceWorker: {
        register: async () => {
          registerCalls += 1;
          return registration;
        },
        ready: Promise.resolve(registration)
      }
    }
  });
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();

  await harness.hooks.registerServiceWorker();
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'error');

  harness.listeners.window.online();
  await settle();

  assert.equal(registerCalls, 1);
  assert.equal(setupCalls, 2);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
});

test('notification action actively sets up a missing sync client', async () => {
  let registerCalls = 0;
  let setupCalls = 0;
  let testCalls = 0;
  const registration = {};
  const sync = {
    setup: async () => {
      setupCalls += 1;
      return { status: 'ready' };
    },
    sync: async () => ({ status: 'ready' }),
    sendTest: async () => {
      testCalls += 1;
      return { status: 'ready' };
    }
  };
  const harness = createHarness({
    sync,
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    navigator: {
      serviceWorker: {
        register: async () => {
          registerCalls += 1;
          return registration;
        },
        ready: Promise.resolve(registration)
      }
    },
    legacy: {
      getPermissionStatus: () => 'granted',
      setEnabled() {},
      scheduleAll() {},
      getMissedCount: () => 0,
      setServiceWorkerRegistration() {}
    }
  });

  await harness.hooks.handleNotificationAction();
  await settle();

  assert.equal(registerCalls, 1);
  assert.equal(setupCalls, 1);
  assert.equal(testCalls, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
});

test('pagehide invalidates deferred setup before publication or recovery scheduling', async () => {
  const timers = createFakeTimers();
  let resolveSetup;
  let setupCalls = 0;
  let syncCalls = 0;
  let cancellations = 0;
  const setup = new Promise(resolve => { resolveSetup = resolve; });
  const registration = {};
  const sync = {
    setup() {
      setupCalls += 1;
      return setup;
    },
    sync: async () => {
      syncCalls += 1;
      return { status: 'pending' };
    },
    handleForeground: async () => ({ status: 'pending' }),
    cancelActiveRequests() { cancellations += 1; }
  };
  const harness = createHarness({
    timers,
    sync,
    navigator: {
      onLine: true,
      serviceWorker: {
        register: async () => registration,
        ready: Promise.resolve(registration)
      }
    }
  });
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();

  const setupResult = harness.hooks.registerServiceWorker();
  await settle();
  assert.equal(setupCalls, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'subscribing');

  harness.listeners.window.pagehide();
  resolveSetup({ status: 'pending' });
  await setupResult;
  await settle();

  assert.equal(cancellations, 1);
  assert.equal(syncCalls, 0);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'subscribing');
  assert.equal(timers.count(), 0);
});

test('pagehide then visible invalidates an ordinary deferred projection completion', async () => {
  const timers = createFakeTimers();
  let resolveProjection;
  let modelCalls = 0;
  const synced = [];
  const staleData = { marker: 'stale' };
  const freshData = { marker: 'fresh' };
  const projection = new Promise(resolve => { resolveProjection = resolve; });
  const model = {
    buildReminderRecords(data) {
      modelCalls += 1;
      return data === staleData ? projection : Promise.resolve([]);
    }
  };
  const sync = {
    handleForeground: async () => ({ status: 'ready' }),
    sync: async data => {
      synced.push(data.marker);
      return { status: data === staleData ? 'pending' : 'ready' };
    },
    cancelActiveRequests() {}
  };
  const harness = createHarness({
    timers,
    model,
    sync,
    db: { getAllData: async () => freshData },
    navigator: { onLine: true }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });

  const staleProjection = harness.hooks.queueNotificationSync(staleData);
  await settle();
  assert.equal(modelCalls, 1);

  harness.document.hidden = true;
  harness.listeners.window.pagehide();
  harness.document.hidden = false;
  harness.listeners.document.visibilitychange();
  await settle();
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');

  resolveProjection([]);
  await staleProjection;
  await settle();

  assert.equal(staleData.reminders, undefined);
  assert.deepEqual(synced, ['fresh']);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
  assert.equal(timers.count(), 0);
});

test('stale projection rejection cannot publish an error into a fresh generation', async () => {
  let rejectStaleProjection;
  let resolveFreshProjection;
  const staleData = { marker: 'stale' };
  const freshData = { marker: 'fresh' };
  const staleProjection = new Promise((resolve, reject) => { rejectStaleProjection = reject; });
  const freshProjection = new Promise(resolve => { resolveFreshProjection = resolve; });
  const projected = [];
  const synced = [];
  const model = {
    buildReminderRecords(data) {
      projected.push(data.marker);
      return data === staleData ? staleProjection : freshProjection;
    }
  };
  const sync = {
    handleForeground: async () => ({ status: 'ready' }),
    sync: async data => {
      synced.push(data.marker);
      return { status: 'ready' };
    },
    cancelActiveRequests() {}
  };
  const harness = createHarness({
    model,
    sync,
    db: { getAllData: async () => freshData },
    navigator: { onLine: true }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });

  const staleResult = harness.hooks.queueNotificationSync(staleData).catch(() => null);
  await settle();
  harness.document.hidden = true;
  harness.listeners.window.pagehide();
  harness.document.hidden = false;
  harness.listeners.document.visibilitychange();
  await settle();

  rejectStaleProjection(new Error('stale projection failed'));
  await settle();
  const statusAfterStaleReject = harness.hooks.getNotificationBackendStatus().status;

  resolveFreshProjection([]);
  await staleResult;
  await settle();

  assert.notEqual(statusAfterStaleReject, 'error');
  assert.deepEqual(projected, ['stale', 'fresh']);
  assert.deepEqual(synced, ['fresh']);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
});

test('a never-settling stale projection does not own the fresh generation', async () => {
  const staleData = { marker: 'stale' };
  const freshData = { marker: 'fresh' };
  const projected = [];
  const synced = [];
  const model = {
    buildReminderRecords(data) {
      projected.push(data.marker);
      return data === staleData ? new Promise(() => {}) : Promise.resolve([]);
    }
  };
  const sync = {
    handleForeground: async () => ({ status: 'ready' }),
    sync: async data => {
      synced.push(data.marker);
      return { status: 'ready' };
    },
    cancelActiveRequests() {}
  };
  const harness = createHarness({
    model,
    sync,
    db: { getAllData: async () => freshData },
    navigator: { onLine: true }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });

  harness.hooks.queueNotificationSync(staleData);
  await settle();
  harness.document.hidden = true;
  harness.listeners.window.pagehide();
  harness.document.hidden = false;
  harness.listeners.document.visibilitychange();
  await settle();

  assert.deepEqual(projected, ['stale', 'fresh']);
  assert.deepEqual(synced, ['fresh']);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
});

test('pagehide invalidates a deferred test-notification publication', async () => {
  const timers = createFakeTimers();
  let resolveTest;
  let cancellations = 0;
  const testNotification = new Promise(resolve => { resolveTest = resolve; });
  const sync = {
    sendTest: () => testNotification,
    cancelActiveRequests() { cancellations += 1; }
  };
  const harness = createHarness({
    timers,
    sync,
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    navigator: { onLine: true }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });

  const action = harness.hooks.handleNotificationAction();
  await settle();
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'syncing');

  harness.listeners.window.pagehide();
  resolveTest({ status: 'pending' });
  await action;

  assert.equal(cancellations, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'syncing');
  assert.equal(timers.count(), 0);
});

test('hidden online does not start service worker registration or recovery', async () => {
  let registerCalls = 0;
  let onlineCalls = 0;
  const registration = {};
  const sync = {
    setup: async () => ({ status: 'ready' }),
    handleOnline: async () => {
      onlineCalls += 1;
      return { status: 'ready' };
    },
    sync: async () => ({ status: 'ready' })
  };
  const harness = createHarness({
    sync,
    navigator: {
      onLine: true,
      serviceWorker: {
        register: async () => {
          registerCalls += 1;
          return registration;
        },
        ready: Promise.resolve(registration)
      }
    }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();
  harness.document.hidden = true;

  harness.listeners.window.online();
  await settle();

  assert.equal(registerCalls, 0);
  assert.equal(onlineCalls, 0);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'disabled');
});

test('visible pending recovery uses one timer and lifecycle events cancel active work', async () => {
  const timers = createFakeTimers();
  const calls = [];
  let status = 'pending';
  const sync = {
    handleForeground: async () => {
      calls.push('foreground');
      return { status };
    },
    sync: async () => ({ status }),
    cancelActiveRequests() { calls.push('cancel'); }
  };
  const harness = createHarness({ timers, sync, navigator: { onLine: true } });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();

  harness.listeners.document.visibilitychange();
  await harness.hooks.recoverNotificationForeground();
  assert.deepEqual(calls, ['foreground']);
  assert.equal(timers.count(), 1);

  timers.advance(250);
  await settle();
  assert.deepEqual(calls, ['foreground', 'foreground']);
  assert.equal(timers.count(), 1);

  status = 'ready';
  timers.advance(250);
  await settle();
  assert.deepEqual(calls, ['foreground', 'foreground', 'foreground']);
  assert.equal(timers.count(), 0);

  status = 'pending';
  harness.listeners.document.visibilitychange();
  await harness.hooks.recoverNotificationForeground();
  assert.equal(timers.count(), 1);
  harness.document.hidden = true;
  harness.listeners.document.visibilitychange();
  assert.equal(timers.count(), 0);
  assert.equal(calls.filter(call => call === 'cancel').length, 1);
  harness.listeners.window.pagehide();
  assert.equal(calls.filter(call => call === 'cancel').length, 2);
});

test('repeated pending while a foreground drain is deferred does not start a second drain', async () => {
  const timers = createFakeTimers();
  let resolveForeground;
  let foregroundCalls = 0;
  const foreground = new Promise(resolve => { resolveForeground = resolve; });
  const sync = {
    handleForeground() {
      foregroundCalls += 1;
      return foregroundCalls === 1 ? foreground : Promise.resolve({ status: 'ready' });
    }
  };
  const harness = createHarness({ timers, sync, navigator: { onLine: true } });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'pending' });
  assert.equal(timers.count(), 1);

  timers.advance(250);
  await settle();
  assert.equal(foregroundCalls, 1);
  assert.equal(timers.count(), 0);

  harness.hooks.setNotificationBackendStatus({ status: 'pending' });
  harness.hooks.setNotificationBackendStatus({ status: 'pending' });
  assert.equal(timers.count(), 0);
  timers.advance(250);
  await settle();
  assert.equal(foregroundCalls, 1);

  resolveForeground({ status: 'pending' });
  await settle();
  assert.equal(timers.count(), 1);

  timers.advance(250);
  await settle();
  assert.equal(foregroundCalls, 2);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
  assert.equal(timers.count(), 0);
});

test('direct foreground recovery owns the lifecycle operation while deferred', async () => {
  const timers = createFakeTimers();
  let resolveForeground;
  let foregroundCalls = 0;
  const foreground = new Promise(resolve => { resolveForeground = resolve; });
  const sync = {
    handleForeground() {
      foregroundCalls += 1;
      return foregroundCalls === 1 ? foreground : Promise.resolve({ status: 'ready' });
    },
    sync: async () => ({ status: 'ready' })
  };
  const harness = createHarness({ timers, sync, navigator: { onLine: true } });
  harness.hooks.setNotificationSync(sync);

  const recovery = harness.hooks.recoverNotificationForeground();
  await settle();
  harness.hooks.setNotificationBackendStatus({ status: 'pending' });
  harness.hooks.setNotificationBackendStatus({ status: 'pending' });
  timers.advance(250);
  await settle();
  const callsBeforeCompletion = foregroundCalls;

  resolveForeground({ status: 'ready' });
  await recovery;
  await settle();

  assert.equal(callsBeforeCompletion, 1);
});

test('deferred disable owns the lifecycle operation and blocks foreground timers', async () => {
  const timers = createFakeTimers();
  let resolveDisable;
  let foregroundCalls = 0;
  const disable = new Promise(resolve => { resolveDisable = resolve; });
  const sync = {
    disable: () => disable,
    handleForeground: async () => {
      foregroundCalls += 1;
      return { status: 'ready' };
    }
  };
  const harness = createHarness({
    timers,
    sync,
    navigator: { onLine: true },
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    legacy: {
      getPermissionStatus: () => 'granted',
      setEnabled() {},
      scheduleAll() {},
      getMissedCount: () => 0
    }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });

  const disabling = harness.hooks.handleNotificationDisable();
  await settle();
  harness.hooks.setNotificationBackendStatus({ status: 'pending' });
  harness.hooks.setNotificationBackendStatus({ status: 'pending' });
  timers.advance(250);
  await settle();
  const callsBeforeCompletion = foregroundCalls;

  resolveDisable({ status: 'disabled' });
  await disabling;

  assert.equal(callsBeforeCompletion, 0);
  assert.equal(timers.count(), 0);
});

test('pending startup projection restores one recovery timer after the syncing timer expires', async () => {
  const timers = createFakeTimers();
  let resolveProjection;
  const projection = new Promise(resolve => { resolveProjection = resolve; });
  const registration = {};
  const sync = {
    setup: async () => ({ status: 'pending' }),
    sync: () => projection,
    handleForeground: async () => ({ status: 'pending' })
  };
  const harness = createHarness({
    timers,
    sync,
    navigator: {
      onLine: true,
      serviceWorker: {
        register: async () => registration,
        ready: Promise.resolve(registration)
      }
    }
  });

  await harness.hooks.registerServiceWorker();
  await settle();
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'syncing');

  timers.advance(250);
  await settle();
  assert.equal(timers.count(), 0);

  resolveProjection({ status: 'pending' });
  await settle();

  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'pending');
  assert.equal(timers.count(), 1);
});

test('pagehide invalidates a pending foreground recovery before it can mutate or reschedule', async () => {
  const timers = createFakeTimers();
  let resolveForeground;
  let projections = 0;
  let syncs = 0;
  let cancellations = 0;
  const foreground = new Promise(resolve => { resolveForeground = resolve; });
  const sync = {
    handleForeground: () => foreground,
    sync: async () => { syncs += 1; return { status: 'pending' }; },
    cancelActiveRequests() { cancellations += 1; }
  };
  const db = {
    getAllData: async () => {
      projections += 1;
      return { tasks: [], habits: [], habitLogs: [] };
    }
  };
  const harness = createHarness({
    timers,
    sync,
    db,
    navigator: { onLine: true },
    legacy: {
      getPermissionStatus: () => 'granted',
      scheduleAll() { projections += 1; },
      getMissedCount: () => 0
    }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();
  harness.hooks.setNotificationBackendStatus({ status: 'ready' });

  const recovery = harness.hooks.recoverNotificationForeground();
  await settle();
  harness.listeners.window.pagehide();
  resolveForeground({ status: 'pending' });
  await recovery;

  assert.equal(cancellations, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
  assert.equal(projections, 0);
  assert.equal(syncs, 0);
  assert.equal(timers.count(), 0);
});

test('pagehide invalidates a queued recovery sync before projection mutation or backend work', async () => {
  const timers = createFakeTimers();
  let resolveModel;
  let modelStarts = 0;
  let syncs = 0;
  const data = { tasks: [], habits: [], habitLogs: [] };
  const model = {
    buildReminderRecords() {
      modelStarts += 1;
      return new Promise(resolve => { resolveModel = resolve; });
    }
  };
  const sync = {
    handleForeground: async () => ({ status: 'ready' }),
    sync: async () => { syncs += 1; return { status: 'pending' }; },
    cancelActiveRequests() {}
  };
  const harness = createHarness({
    timers,
    model,
    sync,
    db: { getAllData: async () => data },
    navigator: { onLine: true },
    legacy: {
      getPermissionStatus: () => 'granted',
      scheduleAll() {},
      getMissedCount: () => 0
    }
  });
  harness.hooks.setNotificationSync(sync);
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();
  harness.hooks.setNotificationBackendStatus({ status: 'pending' });

  const recovery = harness.hooks.recoverNotificationForeground();
  await settle();
  assert.equal(modelStarts, 1);

  harness.listeners.window.pagehide();
  resolveModel([{ id: 'reminder-1', sourceIdHash: 'source-1', notifyAt: '2026-07-12T09:00:00.000Z', revision: 1, encryptedValue: 'ciphertext' }]);
  await recovery;
  await settle();

  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
  assert.equal(data.reminders, undefined);
  assert.equal(syncs, 0);
  assert.equal(timers.count(), 0);
});

test('visible recovery stops for terminal foreground statuses', async t => {
  for (const status of ['ready', 'error', 'unsupported']) {
    await t.test(status, async () => {
      const timers = createFakeTimers();
      const sync = {
        handleForeground: async () => ({ status }),
        sync: async () => ({ status }),
        cancelActiveRequests() {}
      };
      const harness = createHarness({ timers, sync, navigator: { onLine: true } });
      harness.hooks.setNotificationSync(sync);
      harness.hooks.cacheElements();
      harness.hooks.bindEvents();

      harness.listeners.document.visibilitychange();
      await settle();

      assert.equal(harness.hooks.getNotificationBackendStatus().status, status);
      assert.equal(timers.count(), 0);
    });
  }
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

test('successful setup survives pagehide without registering again when visible', async () => {
  let registerCalls = 0;
  let setupCalls = 0;
  const registration = {};
  const sync = {
    setup: async () => {
      setupCalls += 1;
      return { status: 'ready' };
    },
    handleForeground: async () => ({ status: 'ready' }),
    sync: async () => ({ status: 'ready' }),
    cancelActiveRequests() {}
  };
  const harness = createHarness({
    sync,
    navigator: {
      onLine: true,
      serviceWorker: {
        register: async () => {
          registerCalls += 1;
          return registration;
        },
        ready: Promise.resolve(registration)
      }
    }
  });
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();

  await harness.hooks.registerServiceWorker();
  await settle();
  harness.document.hidden = true;
  harness.listeners.window.pagehide();
  harness.document.hidden = false;
  harness.listeners.document.visibilitychange();
  await settle();

  assert.equal(registerCalls, 1);
  assert.equal(setupCalls, 1);
});

test('pagehide detaches a never-settling registration so visible recovery retries', async () => {
  let registerCalls = 0;
  let setupCalls = 0;
  const registration = {};
  const sync = {
    setup: async () => {
      setupCalls += 1;
      return { status: 'ready' };
    },
    handleForeground: async () => ({ status: 'ready' }),
    sync: async () => ({ status: 'ready' }),
    cancelActiveRequests() {}
  };
  const harness = createHarness({
    sync,
    db: { getAllData: async () => ({ marker: 'fresh' }) },
    navigator: {
      onLine: true,
      serviceWorker: {
        register: async () => {
          registerCalls += 1;
          return registerCalls === 1 ? new Promise(() => {}) : registration;
        },
        ready: Promise.resolve(registration)
      }
    }
  });
  harness.hooks.cacheElements();
  harness.hooks.bindEvents();

  harness.hooks.registerServiceWorker();
  await settle();
  harness.document.hidden = true;
  harness.listeners.window.pagehide();
  harness.document.hidden = false;
  harness.listeners.document.visibilitychange();
  await settle();

  assert.equal(registerCalls, 2);
  assert.equal(setupCalls, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
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

test('a missing future notification entity switches back to Today and renders again', () => {
  const start = appSource.indexOf('function handleNotificationClick(data)');
  const end = appSource.indexOf('\n  function ', start + 1);
  const handler = appSource.slice(start, end);
  assert.match(handler, /if \(!entity\) \{\s*if \(targetView === 'calendar'\) \{\s*switchView\('today'\);\s*render\(\);\s*\}\s*return;\s*\}/);
});
