const assert = require('assert');

const appPath = require.resolve('./app');
const savedGlobals = new Map();
[
  'window',
  'document',
  'localStorage',
  'history',
  'matchMedia'
].forEach(key => {
  savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
});

function restoreGlobals() {
  savedGlobals.forEach((descriptor, key) => {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete globalThis[key];
    }
  });
}

async function run() {
  const counts = [];
  const listeners = {};
  let persistentRequests = 0;
  let backupRefreshes = 0;
  globalThis.window = globalThis;
  globalThis.document = {
    hidden: false,
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    querySelectorAll() {
      return [];
    },
    documentElement: {
      setAttribute() {}
    }
  };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {}
  };
  globalThis.history = {};
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {}
  });
  globalThis.importData = async () => {};
  const service = {
    async recordExpensesCreated(count) {
      counts.push(count);
    },
    requestPersistentStorage() {
      persistentRequests += 1;
      return new Promise(() => {});
    }
  };
  globalThis.ExpenseBackupUI = {
    async refresh() {
      backupRefreshes += 1;
    }
  };
  globalThis.ExpenseBackupService = service;
  delete require.cache[appPath];
  require('./app');

  assert.strictEqual(typeof listeners.visibilitychange, 'function');
  listeners.visibilitychange();
  await Promise.resolve();
  assert.strictEqual(backupRefreshes, 1);
  globalThis.document.hidden = true;
  listeners.visibilitychange();
  await Promise.resolve();
  assert.strictEqual(backupRefreshes, 1);

  await globalThis.afterExpenseCreated(2);
  await globalThis.afterExpenseCreated();
  assert.deepStrictEqual(counts, [2, 1]);
  assert.strictEqual(persistentRequests, 1);

  globalThis.ExpenseBackupService = {
    async recordExpensesCreated() {
      throw new Error('metadata unavailable');
    },
    requestPersistentStorage() {
      throw new Error('storage unavailable');
    }
  };
  delete require.cache[appPath];
  require('./app');
  await globalThis.afterExpenseCreated(4);
}

run()
  .then(() => {
    console.log('expense-backup-hooks tests passed');
  })
  .finally(() => {
    delete require.cache[appPath];
    restoreGlobals();
  });
