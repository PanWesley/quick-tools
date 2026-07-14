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
  const timers = overrides.timers || { setTimeout, clearTimeout };
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
      setNotificationSync: function(value) { NotificationSync = value; },
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
  assert.equal(harness.elements.get('notification-status').textContent, '等待同步');
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

test('service worker ready deadline returns pending and allows a new setup attempt', async () => {
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

  ready = Promise.resolve(readyRegistration);
  const retry = harness.hooks.registerServiceWorker();
  assert.notStrictEqual(retry, first);
  await retry;
  await settle();

  assert.equal(registerCalls, 2);
  assert.equal(setupCalls, 1);
  assert.equal(harness.hooks.getNotificationBackendStatus().status, 'ready');
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
  await settle();
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
  await settle();
  assert.equal(timers.count(), 1);
  harness.document.hidden = true;
  harness.listeners.document.visibilitychange();
  assert.equal(timers.count(), 0);
  assert.equal(calls.filter(call => call === 'cancel').length, 1);
  harness.listeners.window.pagehide();
  assert.equal(calls.filter(call => call === 'cancel').length, 2);
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
