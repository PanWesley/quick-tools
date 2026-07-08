const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-update.js'), 'utf8');

function loadRuntime(overrides = {}) {
  const deletedCaches = [];
  let timeoutId = 0;
  const sandbox = {
    console: {
      ...console,
      warn() {}
    },
    Promise,
    setTimeout(callback) {
      callback();
      timeoutId += 1;
      return timeoutId;
    },
    clearTimeout() {},
    caches: {
      keys: async () => ['quick-tools-v1', 'expense-tracker-v1.6.8', 'unrelated-cache'],
      delete: async (name) => {
        deletedCaches.push(name);
        return true;
      }
    },
    navigator: {
      onLine: true,
      serviceWorker: overrides.serviceWorker
    },
    location: {
      reload: () => {
        sandbox.reloadCount += 1;
      }
    },
    document: {
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    reloadCount: 0
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'app-update.js' });
  return { sandbox, deletedCaches };
}

async function testActivatesWaitingWorkerClearsCachesAndReloads() {
  let updateCalled = false;
  let postedMessage = null;
  const statusElement = { textContent: '', dataset: {} };
  const waitingWorker = {
    postMessage(message) {
      postedMessage = message;
    }
  };
  const registration = {
    waiting: waitingWorker,
    update: async () => {
      updateCalled = true;
      return registration;
    }
  };
  const serviceWorker = {
    getRegistration: async () => registration,
    addEventListener(eventName, callback) {
      if (eventName === 'controllerchange') {
        callback();
      }
    }
  };
  const { sandbox, deletedCaches } = loadRuntime({ serviceWorker });

  const result = await sandbox.QuickToolsAppUpdate.checkForUpdate({
    statusElement,
    cachePrefixes: ['quick-tools-', 'expense-tracker-']
  });

  assert.strictEqual(updateCalled, true, 'manual update must ask the browser to check the service worker');
  assert.strictEqual(postedMessage.type, 'SKIP_WAITING');
  assert.deepStrictEqual(deletedCaches, ['quick-tools-v1', 'expense-tracker-v1.6.8']);
  assert.strictEqual(sandbox.reloadCount, 1, 'manual update must reload after cache cleanup');
  assert.strictEqual(statusElement.dataset.updateState, 'updating');
  assert.strictEqual(result.status, 'updating');
}

async function testReportsLatestWithoutReloading() {
  const statusElement = { textContent: '', dataset: {} };
  const registration = {
    waiting: null,
    installing: null,
    update: async () => registration
  };
  const serviceWorker = {
    getRegistration: async () => registration,
    addEventListener: () => {}
  };
  const { sandbox, deletedCaches } = loadRuntime({ serviceWorker });

  const result = await sandbox.QuickToolsAppUpdate.checkForUpdate({ statusElement });

  assert.strictEqual(result.status, 'latest');
  assert.strictEqual(sandbox.reloadCount, 0);
  assert.deepStrictEqual(deletedCaches, []);
  assert.strictEqual(statusElement.dataset.updateState, 'latest');
}

async function testReportsUnsupportedWithoutServiceWorker() {
  const statusElement = { textContent: '', dataset: {} };
  const { sandbox } = loadRuntime({ serviceWorker: undefined });

  const result = await sandbox.QuickToolsAppUpdate.checkForUpdate({ statusElement });

  assert.strictEqual(result.status, 'unsupported');
  assert.strictEqual(statusElement.dataset.updateState, 'unsupported');
}

async function testRefreshDoesNotReloadWhenUpdateCheckFails() {
  const statusElement = { textContent: '', dataset: {} };
  const serviceWorker = {
    getRegistration: async () => ({
      update: async () => {
        throw new Error('network unavailable');
      }
    }),
    addEventListener: () => {}
  };
  const { sandbox, deletedCaches } = loadRuntime({ serviceWorker });

  const result = await sandbox.QuickToolsAppUpdate.refreshApp({ statusElement });

  assert.strictEqual(result.status, 'error');
  assert.strictEqual(sandbox.reloadCount, 0);
  assert.deepStrictEqual(deletedCaches, []);
  assert.strictEqual(statusElement.dataset.updateState, 'error');
}

(async () => {
  await testActivatesWaitingWorkerClearsCachesAndReloads();
  await testReportsLatestWithoutReloading();
  await testReportsUnsupportedWithoutServiceWorker();
  await testRefreshDoesNotReloadWhenUpdateCheckFails();
  console.log('app update runtime tests passed');
})();
