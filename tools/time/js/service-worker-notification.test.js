const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const timeRoot = path.resolve(__dirname, '..');
const swSource = fs.readFileSync(path.join(timeRoot, 'sw.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const notificationSource = fs.readFileSync(path.join(__dirname, 'notification.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(timeRoot, 'css/style.css'), 'utf8');
const indexSource = fs.readFileSync(path.join(timeRoot, 'index.html'), 'utf8');
const cryptoApi = require('./notification-crypto.js');

const VALID_PAYLOAD = {
  title: '项目周会',
  body: '10:30 · 工作',
  tag: 'reminder-task-1',
  data: { type: 'task', id: 'task-1', date: '2026-07-12', url: '/tools/time/#today' },
  scheduledAt: '2026-07-12T02:30:00.000Z',
  v: 1
};

async function createHarness(options = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const messages = [];
  const focused = [];
  const imported = [];
  const consoleCalls = [];
  const cacheCalls = [];
  const deletedCaches = [];
  const fetchCalls = [];
  const receiptCalls = [];
  const keyVersions = [];
  let showAttempts = 0;
  let receiptCleanupCalls = 0;
  const deliveredTags = new Set(options.receiptTags || []);
  const key = options.key === undefined
    ? await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    : options.key;
  const visibleTags = new Set(options.visibleTags || []);
  const clients = options.clients || [];
  const registration = {
    async getNotifications({ tag }) {
      if (options.getNotificationsError) throw options.getNotificationsError;
      return visibleTags.has(tag) ? [{ tag }] : [];
    },
    async showNotification(title, notificationOptions) {
      showAttempts += 1;
      if (options.showNotificationError) throw options.showNotificationError;
      shown.push({ title, options: notificationOptions });
      visibleTags.add(notificationOptions.tag);
    }
  };
  const self = {
    location: { origin: 'https://billnest.top' },
    registration,
    clients: {
      claim() {},
      async matchAll() { return clients; },
      async openWindow(url) { opened.push(url); }
    },
    skipWaiting() {},
    addEventListener(type, callback) { listeners[type] = callback; }
  };
  const caches = {
    async keys() { return options.cacheNames || []; },
    async delete(name) { deletedCaches.push(name); return true; },
    async match(request, matchOptions) {
      cacheCalls.push({ operation: 'match', request, options: matchOptions });
      return options.cachedResponse;
    },
    async open(name) {
      return {
        async addAll(assets) { cacheCalls.push({ operation: 'addAll', name, assets }); },
        async put(request, response) { cacheCalls.push({ operation: 'put', name, request, response }); }
      };
    }
  };
  const context = {
    self,
    caches,
    fetch: async request => {
      fetchCalls.push(request);
      return options.networkResponse || { ok: true, clone() { return this; } };
    },
    importScripts(url) {
      imported.push(url);
      if (url.includes('notification-crypto')) {
        self.TodayYouxuNotificationCrypto = {
          async getKey(version) {
            keyVersions.push(version);
            if (options.getKeyError) throw options.getKeyError;
            return key;
          },
          base64UrlDecode: cryptoApi.base64UrlDecode,
          decryptPayload: cryptoApi.decryptPayload
        };
      }
      if (url.includes('notification-receipt')) {
        self.TodayYouxuNotificationReceipt = {
          CACHE_NAME: 'today-youxu-notification-receipts-v1',
          create() {
            return {
              async clearExpired() { receiptCleanupCalls += 1; return true; },
              async has(tag) { receiptCalls.push(['has', tag]); return deliveredTags.has(tag); },
              async record(tag, scheduledAt) {
                receiptCalls.push(['record', tag, scheduledAt]);
                deliveredTags.add(tag);
                return true;
              },
              async recordFailure(code) { receiptCalls.push(['recordFailure', code]); return true; },
              async clearFailure() { receiptCalls.push(['clearFailure']); return true; }
            };
          }
        };
      }
    },
    console: {
      log(...args) { consoleCalls.push(['log', ...args]); },
      warn(...args) { consoleCalls.push(['warn', ...args]); },
      error(...args) { consoleCalls.push(['error', ...args]); }
    },
    URL,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    JSON,
    Date,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(swSource, context, { filename: 'sw.js' });

  async function dispatch(type, event) {
    let pending;
    event.waitUntil = promise => { pending = Promise.resolve(promise); };
    listeners[type](event);
    if (pending) await pending;
    return event.responsePromise ? event.responsePromise : undefined;
  }

  return {
    key,
    shown,
    opened,
    messages,
    focused,
    imported,
    consoleCalls,
    cacheCalls,
    deletedCaches,
    fetchCalls,
    receiptCalls,
    keyVersions,
    get showAttempts() { return showAttempts; },
    get receiptCleanupCalls() { return receiptCleanupCalls; },
    dispatch,
    listeners
  };
}

async function push(harness, value) {
  return harness.dispatch('push', {
    data: value === null ? null : { text: () => value }
  });
}

test('push decrypts a strict envelope and shows one restrained notification', async () => {
  const harness = await createHarness();
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);

  await push(harness, JSON.stringify(envelope));

  assert.deepEqual(harness.imported, [
    '/tools/time/js/notification-crypto.js?v=2',
    '/tools/time/js/notification-receipt.js?v=1'
  ]);
  assert.deepEqual(harness.keyVersions, [2]);
  assert.equal(harness.receiptCleanupCalls, 1);
  assert.equal(harness.shown.length, 1);
  assert.equal(harness.shown[0].title, VALID_PAYLOAD.title);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.shown[0].options)), {
    body: VALID_PAYLOAD.body,
    tag: VALID_PAYLOAD.tag,
    data: VALID_PAYLOAD.data,
    icon: '/icons/today-youxu-icon-192x192.png',
    badge: '/icons/today-youxu-icon-72x72.png'
  });
  assert.equal('renotify' in harness.shown[0].options, false);
  assert.equal('requireInteraction' in harness.shown[0].options, false);
  assert.deepEqual(harness.receiptCalls, [
    ['has', VALID_PAYLOAD.tag],
    ['clearFailure'],
    ['record', VALID_PAYLOAD.tag, Date.parse(VALID_PAYLOAD.scheduledAt)]
  ]);
});

test('missing key or decryption failure shows the deduplicated generic fallback', async () => {
  const source = await createHarness();
  const envelope = await cryptoApi.encryptPayload(source.key, VALID_PAYLOAD);
  const harness = await createHarness({ key: null });

  await push(harness, JSON.stringify(envelope));
  await push(harness, JSON.stringify(envelope));

  assert.equal(harness.shown.length, 1);
  assert.equal(harness.shown[0].title, '你有一项提醒');
  assert.equal(harness.shown[0].options.body, '打开今日有序查看详情');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.shown[0].options.data)), { url: '/tools/time/#today' });
  assert.deepEqual(harness.receiptCalls.filter(call => call[0] === 'recordFailure'), [
    ['recordFailure', 'missing_key'],
    ['recordFailure', 'missing_key']
  ]);
  assert.equal(harness.receiptCalls.some(call => call[0] === 'record'), false);
});

test('an already visible notification with the same tag is not shown again', async () => {
  const harness = await createHarness({ visibleTags: [VALID_PAYLOAD.tag] });
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);

  await push(harness, JSON.stringify(envelope));

  assert.equal(harness.shown.length, 0);
});

test('a background receipt suppresses a repeated push after the system banner is gone', async () => {
  const harness = await createHarness({ receiptTags: [VALID_PAYLOAD.tag] });
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);

  await push(harness, JSON.stringify(envelope));

  assert.equal(harness.shown.length, 0);
  assert.deepEqual(harness.receiptCalls, [
    ['has', VALID_PAYLOAD.tag],
    ['clearFailure'],
    ['record', VALID_PAYLOAD.tag, Date.parse(VALID_PAYLOAD.scheduledAt)]
  ]);
});

test('key storage errors use the missing-key fallback instead of rejecting push', async () => {
  const harness = await createHarness({ getKeyError: new Error('IndexedDB unavailable') });
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);

  await push(harness, JSON.stringify(envelope));

  assert.equal(harness.shown[0].title, '你有一项提醒');
  assert.deepEqual(harness.receiptCalls.filter(call => call[0] === 'recordFailure'), [
    ['recordFailure', 'missing_key']
  ]);
});

test('malformed JSON and envelopes with extra keys use the generic fallback', async () => {
  const malformed = await createHarness();
  await push(malformed, '{not-json');
  assert.equal(malformed.shown[0].title, '你有一项提醒');
  assert.deepEqual(malformed.receiptCalls, [['recordFailure', 'invalid_envelope']]);

  const extra = await createHarness();
  const envelope = await cryptoApi.encryptPayload(extra.key, VALID_PAYLOAD);
  await push(extra, JSON.stringify({ ...envelope, extra: 'reject me' }));
  assert.equal(extra.shown[0].title, '你有一项提醒');
  assert.deepEqual(extra.receiptCalls, [['recordFailure', 'invalid_envelope']]);
});

test('invalid base64url and IV length are classified as invalid envelopes', async () => {
  for (const envelope of [
    { v: 2, iv: 'not+base64', ciphertext: 'validlookingvalue1234' },
    { v: 2, iv: 'c2hvcnQ', ciphertext: 'validlookingvalue1234' }
  ]) {
    const harness = await createHarness();
    await push(harness, JSON.stringify(envelope));
    assert.deepEqual(harness.receiptCalls.filter(call => call[0] === 'recordFailure'), [
      ['recordFailure', 'invalid_envelope']
    ]);
  }
});

test('push failure diagnostics distinguish missing data, decrypt failure, and invalid plaintext', async () => {
  const missingData = await createHarness();
  await push(missingData, null);
  assert.deepEqual(missingData.receiptCalls, [['recordFailure', 'missing_data']]);

  const source = await createHarness();
  const encrypted = await cryptoApi.encryptPayload(source.key, VALID_PAYLOAD);
  const decryptFailure = await createHarness();
  encrypted.ciphertext = (encrypted.ciphertext.startsWith('A') ? 'B' : 'A') + encrypted.ciphertext.slice(1);
  await push(decryptFailure, JSON.stringify(encrypted));
  assert.deepEqual(decryptFailure.receiptCalls, [['recordFailure', 'decrypt_failed']]);

  const invalidPlaintext = await createHarness();
  const invalidEnvelope = await cryptoApi.encryptPayload(invalidPlaintext.key, { ...VALID_PAYLOAD, title: '' });
  await push(invalidPlaintext, JSON.stringify(invalidEnvelope));
  assert.deepEqual(invalidPlaintext.receiptCalls, [['recordFailure', 'invalid_payload']]);
});

test('decrypted payload shape rejects missing, extra, oversized, and invalid fields', async () => {
  const invalidPayloads = [
    { ...VALID_PAYLOAD, body: undefined },
    { ...VALID_PAYLOAD, extra: true },
    { ...VALID_PAYLOAD, title: 'x'.repeat(121) },
    { ...VALID_PAYLOAD, scheduledAt: 'not-a-date' },
    { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, type: 'note' } },
    { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, date: '2026-02-31' } },
    { ...VALID_PAYLOAD, tag: 'today-youxu-generic-reminder' },
    { ...VALID_PAYLOAD, v: 2 }
  ];

  for (const payload of invalidPayloads) {
    const harness = await createHarness();
    const envelope = await cryptoApi.encryptPayload(harness.key, payload);
    await push(harness, JSON.stringify(envelope));
    assert.equal(harness.shown.length, 1);
    assert.equal(harness.shown[0].title, '你有一项提醒');
  }
});

test('push, click, and close never log encrypted or plaintext payload fields', async () => {
  const harness = await createHarness();
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);
  await push(harness, JSON.stringify(envelope));
  await harness.dispatch('notificationclick', {
    notification: { data: VALID_PAYLOAD.data, close() {} }
  });
  if (harness.listeners.notificationclose) {
    await harness.dispatch('notificationclose', {
      notification: { title: VALID_PAYLOAD.title, body: VALID_PAYLOAD.body, data: VALID_PAYLOAD.data }
    });
  }

  const logged = JSON.stringify(harness.consoleCalls);
  assert.doesNotMatch(logged, /项目周会|10:30|ciphertext|reminder-task-1|task-1|2026-07-12|#today/);
});

test('getNotifications failure still attempts to show the notification', async () => {
  const harness = await createHarness({ getNotificationsError: new Error('lookup failed') });
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);

  await push(harness, JSON.stringify(envelope));

  assert.equal(harness.shown.length, 1);
  assert.equal(harness.shown[0].title, VALID_PAYLOAD.title);
});

test('showNotification failure rejects push handling without another display attempt', async () => {
  const harness = await createHarness({ showNotificationError: new Error('display failed') });
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);

  await assert.rejects(() => push(harness, JSON.stringify(envelope)), /display failed/);
  assert.equal(harness.showAttempts, 1);
  assert.equal(harness.shown.length, 0);
});

test('notification click focuses a time client and posts a sanitized target', async () => {
  const messages = [];
  let focused = 0;
  const client = {
    url: 'https://billnest.top/tools/time/#list',
    postMessage(message) { messages.push(message); },
    async focus() { focused += 1; }
  };
  const harness = await createHarness({ clients: [client] });
  let closed = 0;

  await harness.dispatch('notificationclick', {
    notification: {
      data: { type: 'task', id: 'task-1', date: '2026-07-12', url: 'https://evil.example/steal' },
      close() { closed += 1; }
    }
  });

  assert.equal(closed, 1);
  assert.equal(focused, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{
    type: 'NOTIFICATION_CLICK',
    data: { type: 'task', id: 'task-1', date: '2026-07-12', url: '/tools/time/#today' }
  }]);
  assert.deepEqual(harness.opened, []);
});

test('notification click opens only an allowed same-origin time URL', async () => {
  const safe = await createHarness();
  await safe.dispatch('notificationclick', {
    notification: { data: { url: '/tools/time/#calendar' }, close() {} }
  });
  assert.deepEqual(safe.opened, ['/tools/time/#calendar']);

  const hostile = await createHarness();
  await hostile.dispatch('notificationclick', {
    notification: { data: { url: '//evil.example/tools/time/' }, close() {} }
  });
  assert.deepEqual(hostile.opened, ['/tools/time/#today']);
  assert.equal((swSource.match(/addEventListener\(['"]notificationclick['"]/g) || []).length, 1);
});

function createTargetingHarness() {
  const rows = { today: [], calendar: [] };
  function makeRow(type, id, date) {
    return {
      dataset: { notificationType: type, notificationId: id, notificationDate: date },
      scrollCalls: 0,
      highlightCalls: 0,
      scrollIntoView() { this.scrollCalls += 1; },
      classList: {
        add() { this.owner.highlightCalls += 1; },
        remove() {}
      }
    };
  }
  function makeView(name) {
    return {
      id: 'view-' + name,
      active: name === 'today',
      classList: { toggle(_className, active) { this.owner.active = active; } },
      querySelectorAll() { return rows[name]; }
    };
  }
  const views = { today: makeView('today'), calendar: makeView('calendar') };
  Object.values(views).forEach(view => { view.classList.owner = view; });
  const headers = { 'app-header-title': { textContent: '' }, 'app-header-desc': { textContent: '' } };
  const document = {
    querySelectorAll(selector) {
      if (selector === '.view') return Object.values(views);
      return [];
    },
    querySelector() { return null; },
    getElementById(id) { return views[id.replace('view-', '')] || headers[id] || null; },
    addEventListener() {},
    body: { setAttribute() {} }
  };
  const DateUtils = {
    getTodayKey: () => '2026-07-12',
    formatWeekday: () => '日',
    fromDateKey(value) {
      const parts = String(value).split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    },
    toDateKey(date) {
      return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }
  };
  const window = {
    TodayYouxuDateUtils: DateUtils,
    TodayYouxuState: {
      getTodayTaskGroups() {
        return { pending: [], completed: [] };
      }
    },
    TodayYouxuExport: {},
    TodayYouxuDB: {},
    TodayYouxuNotification: null,
    TodayYouxuNotificationModel: null,
    TodayYouxuNotificationSync: null,
    TodayYouxuQuickEditor: require('./quick-editor-state.js'),
    location: { hash: '#today' },
    __renderCalls: 0
  };
  window.window = window;
  const source = appSource
    .replace('    render();\n    requestAnimationFrame(function() {', '    window.__renderCalls += 1;\n    requestAnimationFrame(function() {')
    .replace("  document.addEventListener('DOMContentLoaded', init);", `
      window.__targetingHooks = {
        handleNotificationClick: handleNotificationClick,
        getState: function() { return appState; }
      };
    `);
  vm.runInNewContext(source, {
    window,
    document,
    navigator: {},
    localStorage: { getItem() { return null; }, setItem() {} },
    console: { warn() {}, error() {}, log() {} },
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback) { callback(); },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    URL,
    Date,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    JSON
  }, { filename: 'app.js' });
  return {
    rows,
    views,
    window,
    hooks: window.__targetingHooks,
    addRow(view, type, id, date) {
      const row = makeRow(type, id, date);
      row.classList.owner = row;
      rows[view].push(row);
      return row;
    }
  };
}

test('future task and habit notifications target only the visible calendar date and month', () => {
  for (const type of ['task', 'habit']) {
    const harness = createTargetingHarness();
    const hidden = harness.addRow('today', type, type + '-future', '2026-09-03');
    const visible = harness.addRow('calendar', type, type + '-future', '2026-09-03');

    harness.hooks.handleNotificationClick({ type, id: type + '-future', date: '2026-09-03' });

    const state = harness.hooks.getState();
    assert.equal(state.view, 'calendar');
    assert.equal(state.selectedDateKey, '2026-09-03');
    assert.equal(state.calendarYear, 2026);
    assert.equal(state.calendarMonth, 8);
    assert.equal(harness.views.calendar.active, true);
    assert.equal(hidden.scrollCalls, 0);
    assert.equal(visible.scrollCalls, 1);
    assert.equal(visible.highlightCalls, 1);
  }
});

test('today notification remains in Today and ignores matching hidden calendar rows', () => {
  const harness = createTargetingHarness();
  const visible = harness.addRow('today', 'task', 'task-today', '2026-07-12');
  const hidden = harness.addRow('calendar', 'task', 'task-today', '2026-07-12');

  harness.hooks.handleNotificationClick({ type: 'task', id: 'task-today', date: '2026-07-12' });

  assert.equal(harness.hooks.getState().view, 'today');
  assert.equal(visible.scrollCalls, 1);
  assert.equal(hidden.scrollCalls, 0);
});

test('app source renders stable notification attributes and owns message targeting alone', () => {
  assert.match(appSource, /data-notification-type="task"/);
  assert.match(appSource, /data-notification-type="habit"/);
  assert.match(appSource, /data-notification-id="['"]?\s*\+\s*escapeHtml\(/);
  assert.match(appSource, /data-notification-date="['"]?\s*\+\s*escapeHtml\(/);
  assert.match(appSource, /event\.data\.type\s*===\s*['"]NOTIFICATION_CLICK['"]/);
  assert.equal((appSource.match(/serviceWorker\.addEventListener\(['"]message['"]/g) || []).length, 1);
  assert.equal((notificationSource.match(/serviceWorker\.addEventListener\(['"]message['"]/g) || []).length, 0);
  assert.match(appSource, /appState\.selectedDateKey\s*=\s*data\.date/);
  assert.match(appSource, /render\(\)[\s\S]*requestAnimationFrame/);
  assert.match(appSource, /scrollIntoView\(\{\s*block:\s*['"]center['"],\s*behavior:\s*['"]smooth['"]\s*\}\)/);
  assert.match(appSource, /classList\.add\(['"]notification-highlight['"]\)/);
  assert.match(appSource, /classList\.remove\(['"]notification-highlight['"]\)/);
  assert.match(cssSource, /\.task-row\.notification-highlight\b/);
  assert.doesNotMatch(cssSource.match(/\.task-row\.notification-highlight[\s\S]*?\}/)[0], /margin|padding|width|height/);
});

test('service worker cache matches current index assets and notification API is network-only', async () => {
  assert.match(swSource, /const CACHE_NAME = ['"]today-youxu-v59['"]/);
  const releaseAssets = [
    '/tools/time/css/style.css?v=163',
    '/tools/time/js/quick-editor-state.js?v=3',
    '/tools/time/js/notification-crypto.js?v=2',
    '/tools/time/js/notification-receipt.js?v=1',
    '/tools/time/js/notification-model.js?v=2',
    '/tools/time/js/notification-sync.js?v=5',
    '/tools/time/js/notification.js?v=7',
    '/tools/time/js/app.js?v=166'
  ];
  const releaseAssetPaths = new Set(releaseAssets.map(asset => asset.split('?')[0]));
  const indexedReleaseAssets = [...indexSource.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(asset => releaseAssetPaths.has(asset.split('?')[0]));
  const appShell = swSource.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1];
  const cachedReleaseAssets = [...appShell.matchAll(/'([^']+)'/g)]
    .map(match => match[1])
    .filter(asset => releaseAssetPaths.has(asset.split('?')[0]));
  assert.deepEqual(indexedReleaseAssets.slice().sort(), releaseAssets.slice().sort());
  assert.deepEqual(cachedReleaseAssets.slice().sort(), releaseAssets.slice().sort());

  const networkResponse = { ok: true, marker: 'network', clone() { return this; } };
  const harness = await createHarness({ cachedResponse: { marker: 'cache' }, networkResponse });
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const request = { method, url: 'https://billnest.top/api/notifications/config' };
    let responsePromise;
    harness.listeners.fetch({
      request,
      respondWith(value) { responsePromise = Promise.resolve(value); }
    });
    assert.strictEqual(await responsePromise, networkResponse);
  }
  assert.equal(harness.fetchCalls.length, 4);
  assert.equal(harness.cacheCalls.length, 0);
  assert.match(swSource, /isNotificationApiPath\(url\.pathname\)[\s\S]*event\.respondWith\(fetch\(request\)\)/);
});

test('service worker activation keeps delivery receipts while removing old app shells', async () => {
  const harness = await createHarness({
    cacheNames: [
      'today-youxu-v32',
      'today-youxu-v33',
      'today-youxu-v56',
      'today-youxu-notification-receipts-v1',
      'unrelated-cache'
    ]
  });

  await harness.dispatch('activate', {});

  assert.deepEqual(harness.deletedCaches, ['today-youxu-v32', 'today-youxu-v33', 'today-youxu-v56']);
  assert.equal(harness.receiptCleanupCalls, 1);
});

test('crypto helper exposes read-only key access without regressing getOrCreateKey', () => {
  assert.equal(typeof cryptoApi.getKey, 'function');
  assert.equal(typeof cryptoApi.getOrCreateKey, 'function');
  assert.match(swSource, /TodayYouxuNotificationCrypto\.getKey\(envelope\.v\)/);
});
