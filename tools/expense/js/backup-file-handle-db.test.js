const assert = require('assert');

function createRequest(run, afterSuccess) {
  const request = {};
  queueMicrotask(() => {
    try {
      request.result = run();
      if (request.onsuccess) request.onsuccess();
      if (afterSuccess) afterSuccess();
    } catch (error) {
      request.error = error;
      if (request.onerror) request.onerror();
    }
  });
  return request;
}

function createFakeIndexedDB(options = {}) {
  const databases = new Map();
  const opens = [];
  const transactions = [];

  return {
    opens,
    transactions,
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
                error: null,
                objectStore() {
                  return {
                    put(value, key) {
                      return createRequest(
                        () => records.set(key, value),
                        () => {
                          if (options.autoComplete !== false && transaction.oncomplete) {
                            queueMicrotask(() => transaction.oncomplete());
                          }
                        }
                      );
                    },
                    get(key) {
                      return createRequest(() => records.get(key));
                    },
                    delete(key) {
                      return createRequest(
                        () => records.delete(key),
                        () => {
                          if (options.autoComplete !== false && transaction.oncomplete) {
                            queueMicrotask(() => transaction.oncomplete());
                          }
                        }
                      );
                    }
                  };
                }
              };
              transactions.push(transaction);
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

function createDualFailureIndexedDB(operationName) {
  return {
    open() {
      const openRequest = {};
      queueMicrotask(() => {
        const database = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const transaction = {
              error: null,
              objectStore() {
                return {
                  [operationName]() {
                    const request = {};
                    queueMicrotask(() => {
                      request.error = new Error(`${operationName} request failed`);
                      request.onerror();
                      queueMicrotask(() => {
                        transaction.error = new Error(
                          `${operationName} transaction failed`
                        );
                        transaction.onerror();
                      });
                    });
                    return request;
                  }
                };
              }
            };
            return transaction;
          }
        };
        openRequest.result = database;
        openRequest.onsuccess();
      });
      return openRequest;
    }
  };
}

async function assertDualFailureIsContained(operationName, invoke) {
  const unhandled = [];
  const onUnhandled = reason => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const fileHandles = createExpenseBackupFileHandles({
      indexedDB: createDualFailureIndexedDB(operationName)
    });
    await assert.rejects(
      () => invoke(fileHandles),
      new RegExp(`${operationName} request failed`)
    );
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
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

  const controlledIndexedDB = createFakeIndexedDB({ autoComplete: false });
  const controlledHandles = createExpenseBackupFileHandles({
    indexedDB: controlledIndexedDB
  });
  let saveSettled = false;
  const pendingSave = controlledHandles.save(handle).then(() => {
    saveSettled = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(saveSettled, false);
  controlledIndexedDB.transactions[0].oncomplete();
  await pendingSave;
  assert.strictEqual(saveSettled, true);

  const abortedClear = controlledHandles.clear();
  await new Promise(resolve => setImmediate(resolve));
  const clearTransaction = controlledIndexedDB.transactions[1];
  clearTransaction.error = new Error('transaction aborted');
  clearTransaction.onabort();
  await assert.rejects(abortedClear, /transaction aborted/);

  const failedSave = controlledHandles.save(handle);
  await new Promise(resolve => setImmediate(resolve));
  const failedTransaction = controlledIndexedDB.transactions[2];
  assert.strictEqual(typeof failedTransaction.onerror, 'function');
  failedTransaction.error = new Error('transaction failed');
  failedTransaction.onerror();
  await assert.rejects(failedSave, /transaction failed/);

  await assertDualFailureIsContained('put', fileHandleDb => (
    fileHandleDb.save(handle)
  ));
  await assertDualFailureIsContained('delete', fileHandleDb => (
    fileHandleDb.clear()
  ));

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
