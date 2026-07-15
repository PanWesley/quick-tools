const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

function request(run, complete) {
  const result = {};
  queueMicrotask(() => {
    try {
      result.result = run();
      if (result.onsuccess) result.onsuccess();
      if (complete && result.transaction && result.transaction.oncomplete) {
        result.transaction.oncomplete();
      }
    } catch (error) {
      result.error = error;
      if (result.onerror) result.onerror();
    }
  });
  return result;
}

function createFakeIndexedDB() {
  const databases = new Map();
  const opens = [];

  return {
    opens,
    dump(name, store) {
      return databases.get(name).stores.get(store);
    },
    open(name, version) {
      opens.push({ name, version });
      const openRequest = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        if (!database) {
          database = {
            stores: new Map(),
            objectStoreNames: {
              contains(storeName) {
                return database.stores.has(storeName);
              }
            },
            createObjectStore(storeName) {
              database.stores.set(storeName, new Map());
            },
            transaction(storeName) {
              const transaction = {};
              transaction.objectStore = function() {
                const records = database.stores.get(storeName);
                return {
                  get(key) {
                    return request(() => records.get(key));
                  },
                  add(value, key) {
                    const addRequest = request(() => {
                      if (records.has(key)) {
                        const error = new Error('Key already exists');
                        error.name = 'ConstraintError';
                        throw error;
                      }
                      records.set(key, value);
                      return key;
                    });
                    addRequest.transaction = transaction;
                    queueMicrotask(() => {
                      if (transaction.oncomplete) transaction.oncomplete();
                    });
                    return addRequest;
                  },
                  put(value, key) {
                    const putRequest = request(() => records.set(key, value));
                    putRequest.transaction = transaction;
                    queueMicrotask(() => {
                      if (transaction.oncomplete) transaction.oncomplete();
                    });
                    return putRequest;
                  }
                };
              };
              return transaction;
            }
          };
          databases.set(name, database);
          openRequest.result = database;
          if (openRequest.onupgradeneeded) openRequest.onupgradeneeded();
        } else {
          openRequest.result = database;
        }
        if (openRequest.onsuccess) openRequest.onsuccess();
      });
      return openRequest;
    }
  };
}

test('AES-GCM round trips Unicode notification payloads with a fresh IV', async () => {
  const cryptoApi = require('./notification-crypto.js');
  const key = await cryptoApi.create({ indexedDB: createFakeIndexedDB(), crypto: webcrypto }).getOrCreateKey();
  const value = { title: '项目周会', body: '10:30 · 工作' };
  const first = await cryptoApi.encryptPayload(key, value);
  const second = await cryptoApi.encryptPayload(key, value);

  assert.equal(first.v, 2);
  assert.notEqual(first.iv, second.iv);
  assert.deepEqual(await cryptoApi.decryptPayload(key, first), value);
});

test('encrypted payloads reject unsupported versions and tampering', async () => {
  const cryptoApi = require('./notification-crypto.js');
  const key = await cryptoApi.create({ indexedDB: createFakeIndexedDB(), crypto: webcrypto }).getOrCreateKey();
  const envelope = await cryptoApi.encryptPayload(key, { title: '喝水', body: '今日打卡 · 健康' });
  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -1) + (envelope.ciphertext.endsWith('A') ? 'B' : 'A') };

  await assert.rejects(() => cryptoApi.decryptPayload(key, { ...envelope, v: 3 }), /Unsupported notification payload version/);
  await assert.rejects(() => cryptoApi.decryptPayload(key, tampered));
});

test('decrypt accepts only a plain own-object with exact envelope keys', async () => {
  const cryptoApi = require('./notification-crypto.js');
  const key = await cryptoApi.create({ indexedDB: createFakeIndexedDB(), crypto: webcrypto }).getOrCreateKey();
  const envelope = await cryptoApi.encryptPayload(key, { title: '喝水' });
  const inheritedCiphertext = Object.create({ ciphertext: envelope.ciphertext });
  inheritedCiphertext.v = envelope.v;
  inheritedCiphertext.iv = envelope.iv;
  const nullPrototype = Object.assign(Object.create(null), envelope);
  const customPrototype = Object.assign(Object.create({ marker: true }), envelope);
  const invalidEnvelopes = [
    { ...envelope, extra: true },
    { v: envelope.v, iv: envelope.iv },
    inheritedCiphertext,
    nullPrototype,
    customPrototype,
    [envelope.v, envelope.iv, envelope.ciphertext]
  ];

  assert.deepEqual(await cryptoApi.decryptPayload(key, envelope), { title: '喝水' });
  for (const invalid of invalidEnvelopes) {
    await assert.rejects(() => cryptoApi.decryptPayload(key, invalid), /Unsupported notification payload version/);
  }
});

test('getOrCreateKey stores portable raw AES bytes and imports one non-extractable key', async () => {
  const indexedDB = createFakeIndexedDB();
  const imports = [];
  const cryptoSpy = {
    getRandomValues(value) {
      return webcrypto.getRandomValues(value);
    },
    subtle: {
      importKey(format, keyData, algorithm, extractable, usages) {
        imports.push({ format, bytes: new Uint8Array(keyData).length, algorithm, extractable, usages });
        return webcrypto.subtle.importKey(format, keyData, algorithm, extractable, usages);
      }
    }
  };
  const cryptoApi = require('./notification-crypto.js');
  const keyStore = cryptoApi.create({ indexedDB, crypto: cryptoSpy });
  const first = await keyStore.getOrCreateKey();
  const second = await keyStore.getOrCreateKey();

  assert.strictEqual(first, second);
  assert.deepEqual(imports, [{
    format: 'raw',
    bytes: 32,
    algorithm: { name: 'AES-GCM' },
    extractable: false,
    usages: ['encrypt', 'decrypt']
  }]);
  assert.equal(first.extractable, false);
  assert.equal(indexedDB.opens[0].name, 'todayYouxuNotificationDB');
  assert.equal(indexedDB.opens[0].version, 1);
  const persisted = indexedDB.dump('todayYouxuNotificationDB', 'secrets').get('payload-key-v2');
  assert.deepEqual(Object.keys(persisted).sort(), ['algorithm', 'rawKey', 'version']);
  assert.equal(persisted.version, 2);
  assert.equal(persisted.algorithm, 'AES-GCM');
  assert.equal(typeof persisted.rawKey, 'string');
  assert.equal(cryptoApi.base64UrlDecode(persisted.rawKey).length, 32);
});

test('concurrent independent key stores import the same persisted winner across contexts', async () => {
  const indexedDB = createFakeIndexedDB();
  const cryptoApi = require('./notification-crypto.js');
  const firstStore = cryptoApi.create({ indexedDB, crypto: webcrypto });
  const secondStore = cryptoApi.create({ indexedDB, crypto: webcrypto });

  const [first, second] = await Promise.all([
    firstStore.getOrCreateKey(),
    secondStore.getOrCreateKey()
  ]);

  const envelope = await cryptoApi.encryptPayload(first, { title: '跨上下文提醒' }, 2);
  assert.deepEqual(await cryptoApi.decryptPayload(second, envelope), { title: '跨上下文提醒' });
  assert.equal(indexedDB.dump('todayYouxuNotificationDB', 'secrets').size, 1);
  assert.equal(cryptoApi.base64UrlDecode(
    indexedDB.dump('todayYouxuNotificationDB', 'secrets').get('payload-key-v2').rawKey
  ).length, 32);
});

test('v2 migration retains and reads a legacy v1 CryptoKey', async () => {
  const indexedDB = createFakeIndexedDB();
  const cryptoApi = require('./notification-crypto.js');
  const store = cryptoApi.create({ indexedDB, crypto: webcrypto });
  assert.equal(await store.getKey(1), null);
  const legacy = await webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  indexedDB.dump('todayYouxuNotificationDB', 'secrets').set('payload-key-v1', legacy);

  await store.getOrCreateKey();

  assert.strictEqual(await store.getKey(1), legacy);
  assert.ok(await store.getKey(2));
  assert.strictEqual(indexedDB.dump('todayYouxuNotificationDB', 'secrets').get('payload-key-v1'), legacy);
});

test('versioned key lookup rejects malformed v2 records and unknown envelope versions', async () => {
  const indexedDB = createFakeIndexedDB();
  const cryptoApi = require('./notification-crypto.js');
  const store = cryptoApi.create({ indexedDB, crypto: webcrypto });
  assert.equal(await store.getKey(2), null);
  indexedDB.dump('todayYouxuNotificationDB', 'secrets').set('payload-key-v2', {
    version: 2,
    algorithm: 'AES-GCM',
    rawKey: cryptoApi.base64UrlEncode(new Uint8Array(31))
  });

  await assert.rejects(() => store.getKey(2), /Notification key record is invalid/);
  const key = await webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  const envelope = await cryptoApi.encryptPayload(key, { title: '提醒' }, 2);
  await assert.rejects(
    () => cryptoApi.decryptPayload(key, { ...envelope, v: 3 }),
    /Unsupported notification payload version/
  );
});
