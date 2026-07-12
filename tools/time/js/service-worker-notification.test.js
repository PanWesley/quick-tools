const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const timeRoot = path.resolve(__dirname, '..');
const swSource = fs.readFileSync(path.join(timeRoot, 'sw.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
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
  const fetchCalls = [];
  const key = options.key === undefined
    ? await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    : options.key;
  const visibleTags = new Set(options.visibleTags || []);
  const clients = options.clients || [];
  const registration = {
    async getNotifications({ tag }) {
      return visibleTags.has(tag) ? [{ tag }] : [];
    },
    async showNotification(title, notificationOptions) {
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
    async keys() { return []; },
    async delete() {},
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
      self.TodayYouxuNotificationCrypto = {
        async getKey() { return key; },
        decryptPayload: cryptoApi.decryptPayload
      };
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
    fetchCalls,
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

  assert.deepEqual(harness.imported, ['/tools/time/js/notification-crypto.js?v=1']);
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
});

test('an already visible notification with the same tag is not shown again', async () => {
  const harness = await createHarness({ visibleTags: [VALID_PAYLOAD.tag] });
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);

  await push(harness, JSON.stringify(envelope));

  assert.equal(harness.shown.length, 0);
});

test('malformed JSON and envelopes with extra keys use the generic fallback', async () => {
  const malformed = await createHarness();
  await push(malformed, '{not-json');
  assert.equal(malformed.shown[0].title, '你有一项提醒');

  const extra = await createHarness();
  const envelope = await cryptoApi.encryptPayload(extra.key, VALID_PAYLOAD);
  await push(extra, JSON.stringify({ ...envelope, extra: 'reject me' }));
  assert.equal(extra.shown[0].title, '你有一项提醒');
});

test('decrypted payload shape rejects missing, extra, oversized, and invalid fields', async () => {
  const invalidPayloads = [
    { ...VALID_PAYLOAD, body: undefined },
    { ...VALID_PAYLOAD, extra: true },
    { ...VALID_PAYLOAD, title: 'x'.repeat(121) },
    { ...VALID_PAYLOAD, scheduledAt: 'not-a-date' },
    { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, type: 'note' } },
    { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, date: '2026-02-31' } },
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

test('push processing never logs the envelope or decrypted plaintext', async () => {
  const harness = await createHarness();
  const envelope = await cryptoApi.encryptPayload(harness.key, VALID_PAYLOAD);
  await push(harness, JSON.stringify(envelope));

  const logged = JSON.stringify(harness.consoleCalls);
  assert.doesNotMatch(logged, /项目周会|10:30|ciphertext|reminder-task-1/);
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

test('app source renders stable notification attributes and targets after rendering', () => {
  assert.match(appSource, /data-notification-type="task"/);
  assert.match(appSource, /data-notification-type="habit"/);
  assert.match(appSource, /data-notification-id="['"]?\s*\+\s*escapeHtml\(/);
  assert.match(appSource, /data-notification-date="['"]?\s*\+\s*escapeHtml\(/);
  assert.match(appSource, /event\.data\.type\s*===\s*['"]NOTIFICATION_CLICK['"]/);
  assert.match(appSource, /switchView\(['"]today['"]\)/);
  assert.match(appSource, /appState\.selectedDateKey\s*=\s*data\.date/);
  assert.match(appSource, /render\(\)[\s\S]*requestAnimationFrame/);
  assert.match(appSource, /scrollIntoView\(\{\s*block:\s*['"]center['"],\s*behavior:\s*['"]smooth['"]\s*\}\)/);
  assert.match(appSource, /classList\.add\(['"]notification-highlight['"]\)/);
  assert.match(appSource, /classList\.remove\(['"]notification-highlight['"]\)/);
  assert.match(cssSource, /\.task-row\.notification-highlight\b/);
  assert.doesNotMatch(cssSource.match(/\.task-row\.notification-highlight[\s\S]*?\}/)[0], /margin|padding|width|height/);
});

test('service worker cache matches current index assets and notification API is network-only', async () => {
  assert.match(swSource, /const CACHE_NAME = ['"]today-youxu-v29['"]/);
  [
    '/tools/time/css/style.css?v=136',
    '/tools/time/js/notification-crypto.js?v=1',
    '/tools/time/js/notification-model.js?v=1',
    '/tools/time/js/notification-sync.js?v=1',
    '/tools/time/js/notification.js?v=5',
    '/tools/time/js/app.js?v=136'
  ].forEach(asset => {
    assert.ok(indexSource.includes(asset), asset + ' must be referenced by index');
    assert.ok(swSource.includes("'" + asset + "'"), asset + ' must be precached exactly');
  });

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

test('crypto helper exposes read-only key access without regressing getOrCreateKey', () => {
  assert.equal(typeof cryptoApi.getKey, 'function');
  assert.equal(typeof cryptoApi.getOrCreateKey, 'function');
  assert.match(swSource, /TodayYouxuNotificationCrypto\.getKey\(\)/);
});
