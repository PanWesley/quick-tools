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

  assert.equal(first.v, 1);
  assert.notEqual(first.iv, second.iv);
  assert.deepEqual(await cryptoApi.decryptPayload(key, first), value);
});

test('encrypted payloads reject unsupported versions and tampering', async () => {
  const cryptoApi = require('./notification-crypto.js');
  const key = await cryptoApi.create({ indexedDB: createFakeIndexedDB(), crypto: webcrypto }).getOrCreateKey();
  const envelope = await cryptoApi.encryptPayload(key, { title: '喝水', body: '今日打卡 · 健康' });
  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -1) + (envelope.ciphertext.endsWith('A') ? 'B' : 'A') };

  await assert.rejects(() => cryptoApi.decryptPayload(key, { ...envelope, v: 2 }), /Unsupported notification payload version/);
  await assert.rejects(() => cryptoApi.decryptPayload(key, tampered));
});

test('getOrCreateKey stores one non-extractable AES-GCM 256-bit key in IndexedDB', async () => {
  const indexedDB = createFakeIndexedDB();
  const generated = [];
  const cryptoSpy = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: {
      ...webcrypto.subtle,
      generateKey(algorithm, extractable, usages) {
        generated.push({ algorithm, extractable, usages });
        return webcrypto.subtle.generateKey(algorithm, extractable, usages);
      }
    }
  };
  const cryptoApi = require('./notification-crypto.js');
  const keyStore = cryptoApi.create({ indexedDB, crypto: cryptoSpy });
  const first = await keyStore.getOrCreateKey();
  const second = await keyStore.getOrCreateKey();

  assert.strictEqual(first, second);
  assert.deepEqual(generated, [{
    algorithm: { name: 'AES-GCM', length: 256 },
    extractable: false,
    usages: ['encrypt', 'decrypt']
  }]);
  assert.equal(indexedDB.opens[0].name, 'todayYouxuNotificationDB');
  assert.equal(indexedDB.opens[0].version, 1);
  assert.strictEqual(indexedDB.dump('todayYouxuNotificationDB', 'secrets').get('payload-key-v1'), first);
});
