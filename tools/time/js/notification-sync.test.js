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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createFakeIndexedDB(options = {}) {
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
            transactionTails: new Map(),
            objectStoreNames: { contains: store => database.stores.has(store) },
            createObjectStore(store) { database.stores.set(store, new Map()); },
            transaction(storeNames, mode = 'readonly') {
              const transaction = {};
              const pending = [];
              let started = false;
              let aborted = false;
              let finish;
              let workingStores;
              const complete = new Promise(resolve => { finish = resolve; });
              const scopes = Array.isArray(storeNames) ? storeNames : [storeNames];
              const previous = Promise.all(scopes.map(storeName =>
                database.transactionTails.get(storeName) || Promise.resolve()));
              scopes.forEach(storeName => {
                database.transactionTails.set(storeName, previous.then(() => complete));
              });

              function start() {
                if (started) return;
                started = true;
                previous.then(() => {
                  workingStores = new Map(scopes.map(storeName => [
                    storeName,
                    new Map(Array.from(database.stores.get(storeName).entries(), ([key, value]) => [key, clone(value)]))
                  ]));
                  function next() {
                    if (aborted) return;
                    if (pending.length) {
                      const operation = pending.shift();
                      try {
                        operation.request.result = operation.run();
                        if (operation.request.onsuccess) operation.request.onsuccess();
                      } catch (error) {
                        operation.request.error = error;
                        let prevented = false;
                        if (operation.request.onerror) {
                          operation.request.onerror({
                            preventDefault() { prevented = true; },
                            stopPropagation() {}
                          });
                        }
                        if (!prevented) {
                          aborted = true;
                          transaction.error = error;
                          if (transaction.onabort) transaction.onabort();
                          else if (transaction.onerror) transaction.onerror();
                          finish();
                          return;
                        }
                      }
                      queueMicrotask(next);
                      return;
                    }
                    queueMicrotask(() => {
                      if (aborted) return;
                      if (pending.length) return next();
                      if (mode === 'readwrite') {
                        scopes.forEach(storeName => database.stores.set(storeName, workingStores.get(storeName)));
                      }
                      if (transaction.oncomplete) transaction.oncomplete();
                      finish();
                    });
                  }
                  next();
                });
              }

              function enqueue(run) {
                const request = {};
                pending.push({ request, run });
                start();
                return request;
              }

              transaction.objectStore = storeName => {
                const records = () => workingStores.get(storeName);
                return {
                  get: key => enqueue(() => clone(records().get(key))),
                  getAll: () => enqueue(() => Array.from(records().values(), clone)),
                  put: (value, key) => enqueue(() => {
                    if (options.failPut && options.failPut(storeName, key, value)) {
                      throw new Error('Injected IndexedDB put failure');
                    }
                    records().set(key, clone(value));
                  }),
                  delete: key => enqueue(() => records().delete(key)),
                  add: (value, key) => enqueue(() => {
                    if (records().has(key)) {
                      const error = new Error('Key already exists');
                      error.name = 'ConstraintError';
                      throw error;
                    }
                    records().set(key, clone(value));
                    return key;
                  })
                };
              };
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

function createFakeLockManager() {
  const tails = new Map();
  return {
    request(name, callback) {
      const previous = tails.get(name) || Promise.resolve();
      let release;
      const held = new Promise(resolve => { release = resolve; });
      const tail = previous.catch(() => {}).then(() => held);
      tails.set(name, tail);
      return previous.catch(() => {}).then(() => callback({ name, mode: 'exclusive' })).finally(() => {
        release();
        if (tails.get(name) === tail) tails.delete(name);
      });
    }
  };
}

const lockManagers = new WeakMap();

function locksFor(indexedDB) {
  if (!lockManagers.has(indexedDB)) lockManagers.set(indexedDB, createFakeLockManager());
  return lockManagers.get(indexedDB);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for condition');
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
  const indexedDB = overrides.indexedDB || createFakeIndexedDB();
  const locks = Object.prototype.hasOwnProperty.call(overrides, 'locks')
    ? overrides.locks
    : locksFor(indexedDB);
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
  const registration = overrides.registration || {
    pushManager: {
      async getSubscription() {
        if (overrides.getSubscriptionError) throw overrides.getSubscriptionError;
        return currentSubscription;
      },
      async subscribe(options) {
        if (overrides.subscribeError) throw overrides.subscribeError;
        calls.push({ subscribe: options });
        if (overrides.subscribe) return overrides.subscribe(options, value => { currentSubscription = value; });
        currentSubscription = subscription('https://push.example/created');
        return currentSubscription;
      }
    }
  };
  const crypto = {
    async getOrCreateKey() { return 'key'; },
    async encryptPayload() { return { v: 1, iv: 'iv', ciphertext: 'ciphertext' }; },
    base64UrlDecode(value) {
      if (overrides.vapidDecodeError) throw overrides.vapidDecodeError;
      return Uint8Array.from(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    }
  };
  const sync = require('./notification-sync.js').create({
    indexedDB,
    locks,
    storage,
    crypto,
    registration,
    notification: { permission: 'granted' },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return overrides.fetch ? overrides.fetch(url, init, calls) : jsonResponse(204);
    },
    clock: overrides.clock || (() => now),
    online: overrides.online || (() => true)
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

test('fake IndexedDB clones values on put and get', async () => {
  const indexedDB = createFakeIndexedDB();
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('clone-test');
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const original = { nested: { value: 1 } };
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('records', 'readwrite');
    transaction.objectStore('records').put(original, 'item');
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
  original.nested.value = 2;
  const firstRead = await new Promise((resolve, reject) => {
    const request = database.transaction('records', 'readonly').objectStore('records').get('item');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  firstRead.nested.value = 3;
  const secondRead = await new Promise((resolve, reject) => {
    const request = database.transaction('records', 'readonly').objectStore('records').get('item');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  assert.equal(secondRead.nested.value, 1);
});

test('fake LockManager releases an exclusive lock after callback throw and rejection', async () => {
  const locks = createFakeLockManager();
  const order = [];
  const thrown = locks.request('notification-lifecycle', () => {
    order.push('throw');
    throw new Error('callback threw');
  });
  const rejected = locks.request('notification-lifecycle', async () => {
    order.push('reject');
    throw new Error('callback rejected');
  });
  const next = locks.request('notification-lifecycle', async () => {
    order.push('next');
    return 'acquired';
  });

  await assert.rejects(thrown, /callback threw/);
  await assert.rejects(rejected, /callback rejected/);
  assert.equal(await next, 'acquired');
  assert.deepEqual(order, ['throw', 'reject', 'next']);
});

test('lifecycle methods return unsupported when Web Locks are unavailable', async () => {
  const harness = createHarness({ locks: null, fetch: responsePlan() });

  assert.deepEqual(await harness.sync.setup(harness.registration), { status: 'unsupported' });
  assert.deepEqual(await harness.sync.enable(), { status: 'unsupported' });
  assert.deepEqual(await harness.sync.sync({ reminders: [] }), { status: 'unsupported' });
  assert.deepEqual(await harness.sync.sendTest(), { status: 'unsupported' });
  assert.deepEqual(await harness.sync.disable(), { status: 'unsupported' });
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'unsupported' });
  assert.deepEqual(await harness.sync.handleForeground(), { status: 'unsupported' });
});

test('a failed lifecycle operation releases the Web Lock for the next instance', async () => {
  let failInstallationWrite = true;
  const indexedDB = createFakeIndexedDB({
    failPut(storeName, key) {
      if (failInstallationWrite && storeName === 'installation' && key === 'current') {
        failInstallationWrite = false;
        return true;
      }
      return false;
    }
  });
  const locks = createFakeLockManager();
  const first = createHarness({ indexedDB, locks, fetch: responsePlan() });
  const second = createHarness({ indexedDB, locks, fetch: responsePlan() });

  assert.equal((await first.sync.enable()).status, 'pending');
  assert.equal((await second.sync.enable()).status, 'ready');
});

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

test('enable converts PushManager and malformed VAPID failures to typed errors', async () => {
  const getFailure = createHarness({ fetch: responsePlan(), getSubscriptionError: new Error('push unavailable') });
  assert.deepEqual(await getFailure.sync.enable(), { status: 'error' });

  const decodeFailure = createHarness({ subscription: null, fetch: responsePlan(), vapidDecodeError: new Error('bad VAPID') });
  assert.deepEqual(await decodeFailure.sync.enable(), { status: 'error' });

  const subscribeFailure = createHarness({ subscription: null, fetch: responsePlan(), subscribeError: new Error('denied') });
  assert.deepEqual(await subscribeFailure.sync.enable(), { status: 'error' });
  assert.deepEqual(await subscribeFailure.sync.getStatus(), { status: 'error' });
  const installation = subscribeFailure.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(installation.enabled, false);
  assert.equal(installation.subscriptionReady, false);
  await subscribeFailure.sync.sync({ reminders: [{
    id: 'subscribe-rejected', revision: 1, sourceIdHash: '5'.repeat(64),
    notifyAt: '2026-07-11T10:30:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'blocked' }
  }] });
  assert.equal(subscribeFailure.calls.some(call => /\/reminders\//.test(call.url || '')), false);
});

test('subscription toJSON failures are converted to a typed error', async () => {
  const broken = subscription('https://push.example/broken-json');
  broken.toJSON = () => { throw new Error('serialization failed'); };
  const harness = createHarness({ subscription: broken, fetch: responsePlan() });

  assert.deepEqual(await harness.sync.enable(), { status: 'error' });
  assert.deepEqual(await harness.sync.getStatus(), { status: 'error' });
  const installation = harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(installation.enabled, false);
  assert.equal(installation.subscriptionReady, false);
});

test('queued subscription PUT recovery atomically marks the installation ready before reminder sync', async () => {
  let subscriptionOffline = true;
  let reminderCalls = 0;
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/subscription$/.test(url) && init.method === 'PUT' && subscriptionOffline) {
        throw new Error('offline');
      }
      if (/\/reminders\//.test(url)) reminderCalls += 1;
      return standard(url, init, calls);
    }
  });

  assert.deepEqual(await harness.sync.enable(), { status: 'pending', deviceId: 'device-1' });
  let installation = harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(installation.enabled, false);
  assert.equal(installation.subscriptionReady, false);
  assert.deepEqual(await harness.sync.getStatus(), { status: 'pending', deviceId: 'device-1' });

  assert.equal((await harness.sync.sync({ reminders: [{
    id: 'blocked-until-ready', revision: 1, sourceIdHash: 'f'.repeat(64),
    notifyAt: '2026-07-11T10:30:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' }
  }] })).status, 'pending');
  assert.equal(reminderCalls, 0);

  subscriptionOffline = false;
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'ready', deviceId: 'device-1' });
  installation = harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(installation.enabled, true);
  assert.equal(installation.subscriptionReady, true);
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

test('retry attempts are bounded and terminal entries are not sent again', async () => {
  let reminderAttempts = 0;
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/reminders\//.test(url)) {
        reminderAttempts += 1;
        throw new Error('offline');
      }
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  await harness.sync.sync({ reminders: [{
    id: 'task-retry', revision: 1, sourceIdHash: 'd'.repeat(64),
    notifyAt: '2026-07-11T14:00:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' }
  }] });
  for (let attempt = 1; attempt < 5; attempt += 1) await harness.sync.handleOnline();

  const reminder = Array.from(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').values())
    .find(entry => entry.kind === 'upsert');
  assert.equal(reminderAttempts, 5);
  assert.equal(reminder.attempts, 5);
  assert.equal(reminder.terminal, true);
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'error' });
  assert.equal(reminderAttempts, 5);
});

test('repeated sync keeps the newest reminder intent and the latest reconcile generation', async () => {
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/reminders\/|\/reconcile$/.test(url)) throw new Error('offline');
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  const reminder = revision => ({
    id: 'task-coalesce', revision, sourceIdHash: 'e'.repeat(64),
    notifyAt: '2026-07-11T15:00:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: `ciphertext-${revision}` }
  });
  await harness.sync.sync({ reminders: [reminder(1)] });
  await harness.sync.sync({ reminders: [reminder(2)] });
  await harness.sync.sync({ reminders: [reminder(1)] });

  const entries = Array.from(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').values());
  assert.equal(entries.length, 2);
  assert.equal(entries.find(entry => entry.kind === 'upsert').body.revision, 2);
  assert.equal(entries.find(entry => entry.kind === 'reconcile').body.reminders[0].revision, 1);
  assert.equal(entries.find(entry => entry.kind === 'reconcile').version, 3);
});

test('empty reconcile uses a persisted sync generation to supersede an old high revision', async () => {
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/reconcile$/.test(url)) throw new Error('offline');
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  await harness.sync.sync({ reminders: [{
    id: 'task-high-revision', revision: 999, sourceIdHash: '6'.repeat(64),
    notifyAt: '2026-07-11T15:00:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' }
  }] });
  await harness.sync.sync({ reminders: [] });

  const reconcile = Array.from(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').values())
    .find(entry => entry.kind === 'reconcile');
  assert.deepEqual(reconcile.body.reminders, []);
  assert.equal(reconcile.version, 2);
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'meta').get('sync-generation'), 2);
});

test('failed subscription PUTs coalesce by device logical identity', async () => {
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/subscription$/.test(url) && init.method === 'PUT') throw new Error('offline');
      return standard(url, init, calls);
    }
  });

  await harness.sync.enable();
  await harness.sync.enable();

  const subscriptions = Array.from(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').values())
    .filter(entry => entry.kind === 'subscription');
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].logicalKey, 'subscription:device-1');
});

test('direct subscription PUT success removes the queued logical intent before drain', async () => {
  const standard = responsePlan();
  let failSubscription = true;
  let subscriptionPuts = 0;
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/subscription$/.test(url) && init.method === 'PUT') {
        subscriptionPuts += 1;
        if (failSubscription) throw new Error('offline');
      }
      return standard(url, init, calls);
    }
  });
  assert.deepEqual(await harness.sync.enable(), { status: 'pending', deviceId: 'device-1' });

  failSubscription = false;
  assert.deepEqual(await harness.sync.enable(), { status: 'ready', deviceId: 'device-1' });
  assert.equal(subscriptionPuts, 2);
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').size, 0);
});

test('queue limit returns a typed error and never persists more than 100 intents', async () => {
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/reminders\//.test(url)) throw new Error('offline');
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  const reminders = Array.from({ length: 101 }, (_, index) => ({
    id: `task-limit-${index}`, revision: 1, sourceIdHash: String(index).padStart(64, 'f'),
    notifyAt: '2026-07-11T16:00:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: `ciphertext-${index}` }
  }));

  assert.deepEqual(await harness.sync.sync({ reminders }), { status: 'error' });
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').size, 100);
});

test('terminal records are compacted so a new intent can be queued and sent without hiding the error state', async () => {
  let reminderCalls = 0;
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (url.endsWith('/after-capacity')) reminderCalls += 1;
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  const queue = harness.indexedDB.dump('todayYouxuNotificationDB', 'queue');
  for (let index = 1; index <= 100; index += 1) {
    queue.set(`terminal-${index}`, {
      id: `terminal-${index}`, sequence: index, generation: 1,
      logicalKey: `terminal:${index}`, kind: 'upsert', method: 'PUT', path: `/terminal/${index}`,
      body: null, attempts: 5, nextRetryAt: null, terminal: true
    });
  }

  assert.equal((await harness.sync.sync({ reminders: [{
    id: 'after-capacity', revision: 1, sourceIdHash: '6'.repeat(64),
    notifyAt: '2026-07-11T15:00:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'new' }
  }] })).status, 'error');
  assert.equal(reminderCalls, 1);
  const persistedQueue = harness.indexedDB.dump('todayYouxuNotificationDB', 'queue');
  assert.ok(persistedQueue.size <= 100);
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'meta').get('queue-compact-error'), true);
  for (const [id, entry] of persistedQueue) if (entry.terminal) persistedQueue.delete(id);
  assert.deepEqual(await harness.sync.getStatus(), { status: 'error' });
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

test('queue ids and explicit sequence remain unique across instances in the same millisecond', async () => {
  const indexedDB = createFakeIndexedDB();
  const standard = responsePlan();
  const fetch = async (url, init, calls) => {
    if (/\/reminders\//.test(url)) throw new Error('offline');
    return standard(url, init, calls);
  };
  const first = createHarness({ indexedDB, fetch });
  const second = createHarness({ indexedDB, fetch });
  await first.sync.enable();
  await second.sync.enable();
  const reminders = Array.from({ length: 12 }, (_, index) => ({
    id: `task-${index + 1}`,
    revision: 1,
    sourceIdHash: String(index).padStart(64, '0'),
    notifyAt: '2026-07-11T13:00:00.000Z',
    encryptedPayload: { v: 1, iv: 'iv', ciphertext: `ciphertext-${index}` }
  }));

  await Promise.all([
    first.sync.sync({ reminders: reminders.slice(0, 6) }),
    second.sync.sync({ reminders: reminders.slice(6) })
  ]);

  const entries = Array.from(indexedDB.dump('todayYouxuNotificationDB', 'queue').values());
  assert.equal(entries.length, 13);
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  assert.deepEqual(entries.map(entry => entry.sequence).sort((left, right) => left - right),
    Array.from({ length: 13 }, (_, index) => index + 1));
});

test('overlapping drains across page and worker instances send each queued intent once', async () => {
  const indexedDB = createFakeIndexedDB();
  const response = deferred();
  const standard = responsePlan();
  let mode = 'offline';
  let reminderCalls = 0;
  const fetch = async (url, init, calls) => {
    if (/\/reminders\//.test(url)) {
      reminderCalls += 1;
      if (mode === 'offline') throw new Error('offline');
      return response.promise;
    }
    return standard(url, init, calls);
  };
  const page = createHarness({ indexedDB, fetch });
  const worker = createHarness({ indexedDB, fetch });
  await page.sync.enable();
  await worker.sync.enable();
  await page.sync.sync({ reminders: [{
    id: 'task-drain', revision: 1, sourceIdHash: '9'.repeat(64),
    notifyAt: '2026-07-11T13:30:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' }
  }] });
  mode = 'defer';
  const firstDrain = page.sync.handleOnline();
  await waitFor(() => reminderCalls === 2);
  const secondDrain = worker.sync.handleOnline();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(reminderCalls, 2);
  response.resolve(jsonResponse(204));
  await Promise.all([firstDrain, secondDrain]);
  assert.equal(reminderCalls, 2);
});

test('a stale response does not delete a newer generation of the same logical intent', async () => {
  const response = deferred();
  const standard = responsePlan();
  let offline = true;
  let reminderCalls = 0;
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/reminders\//.test(url)) {
        reminderCalls += 1;
        if (offline) throw new Error('offline');
        return response.promise;
      }
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  await harness.sync.sync({ reminders: [{
    id: 'task-stale-response', revision: 1, sourceIdHash: '8'.repeat(64),
    notifyAt: '2026-07-11T13:30:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'old' }
  }] });

  offline = false;
  const recovery = harness.sync.handleOnline();
  await waitFor(() => reminderCalls === 2);
  const queue = harness.indexedDB.dump('todayYouxuNotificationDB', 'queue');
  const current = Array.from(queue.values()).find(entry => entry.kind === 'upsert');
  queue.set(current.id, {
    ...current,
    generation: (current.generation || 0) + 1,
    version: 2,
    body: { ...current.body, revision: 2, encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'new' } }
  });
  response.resolve(jsonResponse(204));
  await recovery;

  const persisted = harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').get(current.id);
  assert.equal(persisted.generation, (current.generation || 0) + 1);
  assert.equal(persisted.body.revision, 2);
});

test('a terminal queue entry is skipped so a later logical intent can be delivered', async () => {
  const standard = responsePlan();
  let failOld = true;
  let newReminderCalls = 0;
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (url.endsWith('/task-terminal')) {
        if (failOld) throw new Error('offline');
      }
      if (url.endsWith('/task-after-terminal')) newReminderCalls += 1;
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  await harness.sync.sync({ reminders: [{
    id: 'task-terminal', revision: 1, sourceIdHash: '7'.repeat(64),
    notifyAt: '2026-07-11T13:30:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'terminal' }
  }] });
  for (let attempt = 1; attempt < 5; attempt += 1) await harness.sync.handleOnline();
  failOld = false;

  assert.equal((await harness.sync.sync({ reminders: [{
    id: 'task-after-terminal', revision: 1, sourceIdHash: '9'.repeat(64),
    notifyAt: '2026-07-11T14:00:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'new' }
  }] })).status, 'error');
  assert.equal(newReminderCalls, 1);
  assert.equal(Array.from(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').values())
    .some(entry => entry.logicalKey === 'reminder:task-after-terminal'), false);
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

test('terminal disable cleanup gets a fresh five-attempt generation from every recovery lifecycle', async t => {
  for (const lifecycleMethod of ['handleOnline', 'handleForeground', 'disable']) {
    await t.test(lifecycleMethod, async () => {
      let cleanupFails = true;
      let deleteAttempts = 0;
      const recoveredCleanup = deferred();
      const standard = responsePlan();
      const harness = createHarness({
        fetch: async (url, init, calls) => {
          if (/\/subscription$/.test(url) && init.method === 'DELETE') {
            deleteAttempts += 1;
            if (cleanupFails) throw new Error('offline');
            return recoveredCleanup.promise;
          }
          return standard(url, init, calls);
        }
      });
      await harness.sync.enable();

      assert.equal((await harness.sync.disable()).status, 'pending');
      for (let attempt = 1; attempt < 5; attempt += 1) await harness.sync.handleOnline();
      assert.equal(deleteAttempts, 5);
      const queue = harness.indexedDB.dump('todayYouxuNotificationDB', 'queue');
      const terminal = Array.from(queue.values()).find(entry => entry.kind === 'disable');
      assert.equal(terminal.attempts, 5);
      assert.equal(terminal.terminal, true);

      cleanupFails = false;
      const recovery = harness.sync[lifecycleMethod]();
      await waitFor(() => deleteAttempts === 6);
      const replacement = Array.from(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').values())
        .find(entry => entry.kind === 'disable');
      assert.equal(replacement.generation, terminal.generation + 1);
      assert.equal(replacement.attempts, 0);
      assert.equal(replacement.terminal, false);
      recoveredCleanup.resolve(jsonResponse(204));
      assert.deepEqual(await recovery, { status: 'disabled' });
      assert.equal(deleteAttempts, 6);
      assert.equal(harness.getSubscription().unsubscribed, true);
      assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').size, 0);
    });
  }
});

test('disable serializes against overlapping sync and prevents reminder recreation after cleanup starts', async () => {
  const cleanup = deferred();
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/subscription$/.test(url) && init.method === 'DELETE') return cleanup.promise;
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();

  const disabling = harness.sync.disable();
  await waitFor(() => harness.calls.some(call => call.url === '/api/notifications/devices/device-1/subscription'
    && call.init.method === 'DELETE'));
  const syncing = harness.sync.sync({ reminders: [{
    id: 'task-overlap', revision: 1, sourceIdHash: 'b'.repeat(64),
    notifyAt: '2026-07-11T11:00:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' }
  }] }, '2026-07-11');
  cleanup.resolve(jsonResponse(204));

  assert.deepEqual(await disabling, { status: 'disabled' });
  assert.deepEqual(await syncing, { status: 'disabled' });
  assert.equal(harness.calls.some(call => /\/reminders\/|\/reconcile$/.test(call.url)), false);
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'queue').size, 0);
});

test('cross-instance disable waits for a deferred subscribe and removes the created browser subscription', async () => {
  const indexedDB = createFakeIndexedDB();
  const subscribeResult = deferred();
  const standard = responsePlan();
  const orderedWrites = [];
  let currentSubscription = null;
  let subscribeStarted = false;
  const registration = {
    pushManager: {
      async getSubscription() { return currentSubscription; },
      async subscribe() {
        subscribeStarted = true;
        currentSubscription = await subscribeResult.promise;
        return currentSubscription;
      }
    }
  };
  const fetch = async (url, init, calls) => {
    if (/\/subscription$/.test(url) && init.method === 'PUT') orderedWrites.push('PUT');
    if (/\/subscription$/.test(url) && init.method === 'DELETE') orderedWrites.push('DELETE');
    return standard(url, init, calls);
  };
  const page = createHarness({
    indexedDB,
    fetch,
    registration
  });
  const worker = createHarness({ indexedDB, fetch, registration });

  const enabling = page.sync.enable();
  await waitFor(() => subscribeStarted);
  const disabling = worker.sync.disable();
  await new Promise(resolve => setImmediate(resolve));

  const installation = indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(Boolean(installation.cleanupPending), false);
  assert.deepEqual(orderedWrites, []);

  const created = subscription('https://push.example/deferred');
  subscribeResult.resolve(created);
  assert.equal((await enabling).status, 'ready');
  assert.deepEqual(await disabling, { status: 'disabled' });
  assert.deepEqual(orderedWrites, ['PUT', 'DELETE']);
  assert.equal(created.unsubscribed, true);
});

test('disable atomically rolls back cleanup state when persisting its DELETE intent fails', async () => {
  let failDisableIntent = true;
  const indexedDB = createFakeIndexedDB({
    failPut(storeName, key, value) {
      if (failDisableIntent && storeName === 'queue' && value && value.kind === 'disable') {
        failDisableIntent = false;
        return true;
      }
      return false;
    }
  });
  const harness = createHarness({ indexedDB, fetch: responsePlan() });
  await harness.sync.enable();

  assert.deepEqual(await harness.sync.disable(), { status: 'error' });
  const installation = indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(installation.cleanupPending, undefined);
  assert.equal(Array.from(indexedDB.dump('todayYouxuNotificationDB', 'queue').values())
    .some(entry => entry.kind === 'disable'), false);
});

test('cleanup recovery rebuilds a missing durable DELETE intent', async () => {
  let cleanupFails = true;
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/subscription$/.test(url) && init.method === 'DELETE' && cleanupFails) throw new Error('offline');
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  assert.equal((await harness.sync.disable()).status, 'pending');
  const queue = harness.indexedDB.dump('todayYouxuNotificationDB', 'queue');
  for (const [id, entry] of queue) if (entry.kind === 'disable') queue.delete(id);

  cleanupFails = false;
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'disabled' });
  assert.equal(harness.getSubscription().unsubscribed, true);
});

test('disable discards queued reminder intents and sends server cleanup before browser unsubscribe', async () => {
  let reminderOffline = true;
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/reminders\//.test(url) && reminderOffline) throw new Error('offline');
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  await harness.sync.sync({ reminders: [{
    id: 'task-stale', revision: 1, sourceIdHash: 'c'.repeat(64),
    notifyAt: '2026-07-11T12:00:00.000Z', encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' }
  }] });
  reminderOffline = false;
  const callCount = harness.calls.length;

  assert.deepEqual(await harness.sync.disable(), { status: 'disabled' });

  const cleanupCalls = harness.calls.slice(callCount).filter(call => call.url);
  assert.deepEqual(cleanupCalls.map(call => [call.init.method, call.url]), [[
    'DELETE', '/api/notifications/devices/device-1/subscription'
  ]]);
  assert.equal(harness.getSubscription().unsubscribed, true);
});

test('disable keeps cleanup pending when credentials are missing but a browser subscription remains', async () => {
  const harness = createHarness({ fetch: responsePlan() });
  await harness.sync.enable();
  const installation = harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  delete installation.deviceToken;

  assert.deepEqual(await harness.sync.disable(), { status: 'error' });
  assert.equal(harness.getSubscription().unsubscribed, false);
  const persisted = harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(persisted.enabled, true);
  assert.equal(persisted.cleanupPending, true);
});

test('cleanup with no recoverable device identity never reports ready or unsubscribes', async () => {
  const harness = createHarness({ fetch: responsePlan() });

  assert.deepEqual(await harness.sync.disable(), { status: 'error' });
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'error' });
  assert.equal(harness.getSubscription().unsubscribed, false);
  assert.equal(harness.indexedDB.dump('todayYouxuNotificationDB', 'installation')
    .get('current').cleanupPending, true);
});

test('cleanup authentication rejection preserves the old identity and never auto-enables a replacement device', async () => {
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/subscription$/.test(url) && init.method === 'DELETE') {
        return jsonResponse(403, { error: { code: 'forbidden' } });
      }
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();

  assert.deepEqual(await harness.sync.disable(), { status: 'error' });
  const installation = harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(installation.cleanupPending, true);
  assert.equal(installation.deviceId, 'device-1');
  assert.equal(installation.cleanupDeviceId, 'device-1');
  assert.deepEqual(await harness.sync.getStatus(), { status: 'error' });

  const deviceCalls = harness.calls.filter(call => call.url === '/api/notifications/devices').length;
  const subscriptionPuts = harness.calls.filter(call => /\/subscription$/.test(call.url)
    && call.init.method === 'PUT').length;
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'error' });
  assert.deepEqual(await harness.sync.enable(), { status: 'error' });
  assert.deepEqual(await harness.sync.handleForeground(), { status: 'error' });
  assert.deepEqual(await harness.sync.disable(), { status: 'error' });
  assert.equal(harness.calls.filter(call => call.url === '/api/notifications/devices').length, deviceCalls);
  assert.equal(harness.calls.filter(call => /\/subscription$/.test(call.url)
    && call.init.method === 'PUT').length, subscriptionPuts);
  assert.equal(harness.calls.filter(call => /\/subscription$/.test(call.url)
    && call.init.method === 'DELETE').length, 1);
});

test('unsubscribe false keeps cleanup pending and foreground retries only local cleanup', async () => {
  const harness = createHarness({ fetch: responsePlan() });
  await harness.sync.enable();
  const current = harness.getSubscription();
  let unsubscribeCalls = 0;
  current.unsubscribe = async () => {
    unsubscribeCalls += 1;
    return unsubscribeCalls > 1;
  };

  assert.deepEqual(await harness.sync.disable(), { status: 'pending', deviceId: 'device-1' });
  const installation = harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(installation.cleanupPending, true);
  assert.equal(installation.cleanupServerDone, true);
  assert.equal(installation.enabled, true);
  assert.deepEqual(await harness.sync.getStatus(), { status: 'pending', deviceId: 'device-1' });

  const networkCalls = harness.calls.length;
  assert.deepEqual(await harness.sync.handleForeground(), { status: 'disabled' });
  assert.equal(unsubscribeCalls, 2);
  assert.equal(harness.calls.length, networkCalls);
});

test('unsubscribe rejection remains pending and can be retried without registering again', async () => {
  const harness = createHarness({ fetch: responsePlan() });
  await harness.sync.enable();
  const current = harness.getSubscription();
  let rejectCleanup = true;
  current.unsubscribe = async () => {
    if (rejectCleanup) throw new Error('browser cleanup failed');
    return true;
  };

  assert.deepEqual(await harness.sync.disable(), { status: 'pending', deviceId: 'device-1' });
  rejectCleanup = false;
  assert.deepEqual(await harness.sync.handleOnline(), { status: 'disabled' });
  assert.equal(harness.calls.filter(call => call.url === '/api/notifications/devices').length, 1);
});

test('sendTest is blocked while cleanup is pending and cannot reset cleanup authentication', async () => {
  const standard = responsePlan();
  const harness = createHarness({
    fetch: async (url, init, calls) => {
      if (/\/subscription$/.test(url) && init.method === 'DELETE') throw new Error('offline');
      if (url === '/api/notifications/test') return jsonResponse(401, { error: { code: 'unauthorized' } });
      return standard(url, init, calls);
    }
  });
  await harness.sync.enable();
  assert.equal((await harness.sync.disable()).status, 'pending');

  assert.deepEqual(await harness.sync.sendTest(), { status: 'pending', deviceId: 'device-1' });
  const installation = harness.indexedDB.dump('todayYouxuNotificationDB', 'installation').get('current');
  assert.equal(installation.cleanupPending, true);
  assert.equal(installation.cleanupAuthRejected, false);
  assert.equal(harness.calls.some(call => call.url === '/api/notifications/test'), false);
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
