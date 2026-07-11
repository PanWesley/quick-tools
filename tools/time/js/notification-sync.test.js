const test = require('node:test');
const assert = require('node:assert/strict');

function createRequest(run) {
  const request = {};
  queueMicrotask(() => {
    try {
      request.result = run();
      if (request.onsuccess) request.onsuccess();
    } catch (error) {
      request.error = error;
      if (request.onerror) request.onerror();
    }
  });
  return request;
}

function createFakeIndexedDB() {
  const databases = new Map();

  return {
    dump(name, store) {
      return databases.get(name).stores.get(store);
    },
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        if (!database) {
          database = {
            stores: new Map(),
            objectStoreNames: { contains: store => database.stores.has(store) },
            createObjectStore(store) { database.stores.set(store, new Map()); },
            transaction(store, mode) {
              const transaction = {};
              const records = database.stores.get(store);
              transaction.objectStore = () => ({
                get: key => createRequest(() => records.get(key)),
                getAll: () => createRequest(() => Array.from(records.values())),
                put(value, key) {
                  const result = createRequest(() => records.set(key, value));
                  queueMicrotask(() => {
                    if (transaction.oncomplete) transaction.oncomplete();
                  });
                  return result;
                },
                delete(key) {
                  const result = createRequest(() => records.delete(key));
                  queueMicrotask(() => {
                    if (transaction.oncomplete) transaction.oncomplete();
                  });
                  return result;
                }
              });
              return transaction;
            }
          };
          databases.set(name, database);
          request.result = database;
          if (request.onupgradeneeded) request.onupgradeneeded();
        } else {
          request.result = database;
        }
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    }
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function subscription(endpoint) {
  return {
    endpoint,
    toJSON() {
      return { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } };
    },
    unsubscribed: false,
    async unsubscribe() {
      this.unsubscribed = true;
      return true;
    }
  };
}

function createHarness(overrides = {}) {
  const indexedDB = createFakeIndexedDB();
  const calls = [];
  const storage = {
    writes: [],
    getItem() { return null; },
    setItem(key, value) { this.writes.push([key, value]); }
  };
  let now = 1000;
  let currentSubscription = Object.prototype.hasOwnProperty.call(overrides, 'subscription')
    ? overrides.subscription
    : subscription('https://push.example/original');
  const registration = {
    pushManager: {
      async getSubscription() { return currentSubscription; },
      async subscribe(options) {
        calls.push({ subscribe: options });
        currentSubscription = subscription('https://push.example/created');
        return currentSubscription;
      }
    }
  };
  const crypto = {
    async getOrCreateKey() { return 'key'; },
    async encryptPayload() { return { v: 1, iv: 'iv', ciphertext: 'ciphertext' }; },
    base64UrlDecode(value) {
      return Uint8Array.from(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    }
  };
  const sync = require('./notification-sync.js').create({
    indexedDB,
    storage,
    crypto,
    registration,
    notification: { permission: 'granted' },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return overrides.fetch ? overrides.fetch(url, init, calls) : jsonResponse(204);
    },
    clock: () => now,
    online: () => true
  });

  return {
    sync,
    indexedDB,
    storage,
    calls,
    registration,
    getSubscription: () => currentSubscription,
    setSubscription: value => { currentSubscription = value; },
    advance: milliseconds => { now += milliseconds; }
  };
}

function responsePlan() {
  let device = 0;
  return async (url) => {
    if (url === '/api/notifications/config') {
      return jsonResponse(200, { protocolVersion: 1, vapidPublicKey: 'AQIDBA' });
    }
    if (url === '/api/notifications/devices') {
      device += 1;
      return jsonResponse(201, { deviceId: `device-${device}`, deviceToken: `secret-token-${device}` });
    }
    return jsonResponse(204);
  };
}

test('enable reuses its IndexedDB installation, sends bearer credentials, and keeps the token out of storage/status', async () => {
  const harness = createHarness({ fetch: responsePlan() });

  assert.deepEqual(await harness.sync.setup(harness.registration), { status: 'disabled' });
  assert.deepEqual(await harness.sync.enable(), { status: 'ready', deviceId: 'device-1' });
  assert.deepEqual(await harness.sync.enable(), { status: 'ready', deviceId: 'device-1' });

  const deviceCalls = harness.calls.filter(call => call.url === '/api/notifications/devices');
  const subscriptionCalls = harness.calls.filter(call => /\/subscription$/.test(call.url));
  assert.equal(deviceCalls.length, 1);
  assert.equal(subscriptionCalls.length, 2);
  assert.equal(subscriptionCalls[0].init.headers.Authorization, 'Bearer secret-token-1');
  assert.equal('deviceToken' in await harness.sync.getStatus(), false);
  assert.equal(harness.storage.writes.length, 0);
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current').deviceToken, 'secret-token-1');
});

test('enable converts the VAPID key and requests a visible Push subscription', async () => {
  const harness = createHarness({ subscription: null, fetch: responsePlan() });

  await harness.sync.setup(harness.registration);
  await harness.sync.enable();

  const subscribe = harness.calls.find(call => call.subscribe).subscribe;
  assert.equal(subscribe.userVisibleOnly, true);
  assert.deepEqual(Array.from(subscribe.applicationServerKey), [1, 2, 3, 4]);
});

test('enable replaces an expired PushSubscription before uploading it', async () => {
  const expired = subscription('https://push.example/expired');
  expired.expirationTime = 1000;
  const harness = createHarness({ subscription: expired, fetch: responsePlan() });

  await harness.sync.setup(harness.registration);
  await harness.sync.enable();

  assert.equal(expired.unsubscribed, true);
  assert.ok(harness.calls.some(call => call.subscribe));
  assert.ok(harness.calls.some(call => call.url === '/api/notifications/devices/device-1/subscription'
    && call.init.body.includes('created')));
});

test('sync queues a failed server write and retries it with exponential delay when online', async () => {
  let failReminder = true;
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/reminders\//.test(url) && failReminder) throw new Error('offline');
      return standard(url, init, calls);
    }
  });
  await harness.sync.setup(harness.registration);
  await harness.sync.enable();

  const first = await harness.sync.sync({ reminders: [{
    id: 'task-1', revision: 2, sourceIdHash: 'a'.repeat(64),
    notifyAt: '2026-07-11T10:30:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' }
  }] }, '2026-07-11');
  assert.equal(first.status, 'pending');
  const queued = Array.from(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').values());
  assert.equal(queued.length, 2);
  assert.equal(queued[0].attempts, 1);
  assert.equal(queued[0].nextRetryAt, 2000);

  failReminder = false;
  harness.advance(1000);
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'ready', deviceId: 'device-1' });
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').size, 0);
  const reminderCall = harness.calls.find(call => call.url === '/api/notifications/reminders/task-1' && call.init.headers.Authorization === 'Bearer secret-token-1');
  assert.ok(reminderCall);
});

test('sync records its metadata in the dedicated IndexedDB meta store', async () => {
  const harness = createHarness({ fetch: responsePlan() });
  await harness.sync.setup(harness.registration);
  await harness.sync.enable();

  await harness.sync.sync({ reminders: [] }, '2026-07-11');

  assert.deepEqual(harness.indexedDB.dump('todayYouxuNotificationDB', 'meta').get('sync'), {
    lastSyncAt: 1000,
    todayKey: '2026-07-11'
  });
});

test('disable waits for server cleanup before unsubscribing and exposes pending cleanup failures', async () => {
  let cleanupFails = true;
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/subscription$/.test(url) && init.method === 'DELETE' && cleanupFails) throw new Error('offline');
      return standard(url, init, calls);
    }
  });
  await harness.sync.setup(harness.registration);
  await harness.sync.enable();

  assert.deepEqual(await harness.sync.disable(), { status: 'pending', deviceId: 'device-1' });
  assert.equal(harness.getSubscription().unsubscribed, false);
  assert.deepEqual(await harness.sync.getStatus(), { status: 'pending', deviceId: 'device-1' });

  cleanupFails = false;
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'disabled' });
  assert.equal(harness.getSubscription().unsubscribed, true);
});

test('authentication failures reset the installation and a later enable renews the subscription without reusing stale credentials', async () => {
  let rejectTest = true;
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (url === '/api/notifications/test' && rejectTest) return jsonResponse(401, { error: { code: 'unauthorized' } });
      return standard(url, init, calls);
    }
  });
  await harness.sync.setup(harness.registration);
  await harness.sync.enable();
  harness.setSubscription(subscription('https://push.example/renewed'));
  await harness.sync.enable();
  assert.ok(harness.calls.some(call => call.url === '/api/notifications/devices/device-1/subscription' && call.init.body.includes('renewed')));

  assert.deepEqual(await harness.sync.sendTest({ title: '测试', body: '通知' }), { status: 'error' });
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current').deviceToken, undefined);

  rejectTest = false;
  assert.deepEqual(await harness.sync.enable(), { status: 'ready', deviceId: 'device-2' });
});

test('authentication reset removes queued requests addressed to the invalid installation', async () => {
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/reminders\//.test(url)) return jsonResponse(401, { error: { code: 'unauthorized' } });
      return standard(url, init, calls);
    }
  });
  await harness.sync.setup(harness.registration);
  await harness.sync.enable();

  assert.deepEqual(await harness.sync.sync({ reminders: [{
    id: 'task-1', revision: 1, sourceIdHash: 'a'.repeat(64),
    notifyAt: '2026-07-11T10:30:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' }
  }] }), { status: 'error' });
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').size, 0);
});
