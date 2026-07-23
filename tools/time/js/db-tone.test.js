const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');

function createDbHarness() {
  const stores = { tasks: new Map(), habits: new Map(), opLogs: new Map() };
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => request.onsuccess({ target: { result: db } }));
      return request;
    }
  };
  const db = {
    close() {},
    transaction(names) {
      const requested = Array.isArray(names) ? names : [names];
      const transaction = {
        objectStore(name) {
          return {
            put(value) { stores[name].set(value.id, value); },
            get(id) {
              const request = {};
              queueMicrotask(() => { request.result = stores[name].get(id); request.onsuccess(); });
              return request;
            }
          };
        }
      };
      queueMicrotask(() => transaction.oncomplete());
      return transaction;
    }
  };
  const context = { self: {}, indexedDB, Date, Math, Promise, queueMicrotask };
  vm.runInNewContext(source, context, { filename: 'db.js' });
  return { DB: context.self.TodayYouxuDB, stores };
}

test('task and habit creation persist the chosen tone in IndexedDB entities', async () => {
  const { DB, stores } = createDbHarness();
  const task = await DB.createTask({ title: '任务', tone: 'mint' });
  const habit = await DB.createHabit({ title: '习惯', tone: 'sky' });

  assert.equal(task.tone, 'mint');
  assert.equal(habit.tone, 'sky');
  assert.equal(stores.tasks.get(task.id).tone, 'mint');
  assert.equal(stores.habits.get(habit.id).tone, 'sky');
});
