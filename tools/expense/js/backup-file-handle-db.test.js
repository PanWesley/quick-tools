const assert = require('assert');

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
  const opens = [];

  return {
    opens,
    open(name, version) {
      opens.push({ name, version });
      const request = {};

      queueMicrotask(() => {
        let database = databases.get(name);
        if (!database) {
          const records = new Map();
          const objectStoreNames = {
            contains(storeName) {
              return storeName === 'handles' && database.hasStore;
            }
          };
          database = {
            hasStore: false,
            records,
            objectStoreNames,
            createObjectStore(storeName) {
              assert.strictEqual(storeName, 'handles');
              this.hasStore = true;
            },
            transaction(storeName, mode) {
              assert.strictEqual(storeName, 'handles');
              assert.ok(mode === 'readonly' || mode === 'readwrite');
              const transaction = {
                objectStore() {
                  return {
                    put(value, key) {
                      return createRequest(() => records.set(key, value));
                    },
                    get(key) {
                      return createRequest(() => records.get(key));
                    },
                    delete(key) {
                      return createRequest(() => records.delete(key));
                    }
                  };
                }
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

const previousGlobalDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'ExpenseBackupFileHandles'
);
delete globalThis.ExpenseBackupFileHandles;

const {
  createExpenseBackupFileHandles,
  DB_NAME,
  STORE_NAME,
  AUTOMATIC_BACKUP_KEY
} = require('./backup-file-handle-db');

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(globalThis, 'ExpenseBackupFileHandles'),
  false
);

(async () => {
  const indexedDB = createFakeIndexedDB();
  const fileHandles = createExpenseBackupFileHandles({ indexedDB });
  const handle = { name: 'expense-backup.json' };

  assert.strictEqual(DB_NAME, 'ExpenseTrackerFileHandles');
  assert.strictEqual(STORE_NAME, 'handles');
  assert.strictEqual(AUTOMATIC_BACKUP_KEY, 'automatic-backup');
  assert.strictEqual(await fileHandles.get(), null);

  await fileHandles.save(handle);
  assert.strictEqual(await fileHandles.get(), handle);

  await fileHandles.clear();
  assert.strictEqual(await fileHandles.get(), null);
  assert.deepStrictEqual(indexedDB.opens, [
    { name: 'ExpenseTrackerFileHandles', version: 1 }
  ]);

  await assert.rejects(
    () => createExpenseBackupFileHandles({ indexedDB: null }).get(),
    /IndexedDB is not available/
  );

  console.log('backup-file-handle-db tests passed');
})().finally(() => {
  if (previousGlobalDescriptor) {
    Object.defineProperty(
      globalThis,
      'ExpenseBackupFileHandles',
      previousGlobalDescriptor
    );
  } else {
    delete globalThis.ExpenseBackupFileHandles;
  }
});
