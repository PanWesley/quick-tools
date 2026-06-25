const assert = require('assert');

const previousGlobalDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'ExpenseBackupService'
);
delete globalThis.ExpenseBackupService;

const { createExpenseBackupService, DEFAULT_BACKUP_META } = require('./backup-service');

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(globalThis, 'ExpenseBackupService'),
  false
);

function createHarness(overrides = {}) {
  const settings = new Map();
  const downloads = [];
  const savedHandles = [];
  let storedHandle = null;
  const snapshot = {
    metadata: { databaseVersion: 7 },
    expenses: [{ id: 'expense-1' }, { id: 'expense-2' }],
    tags: [{ id: 'tag-1' }],
    tagGroups: [{ id: 'group-1' }],
    settings: [{ key: 'currency', value: 'CNY' }]
  };

  const deps = {
    async createDatabaseSnapshot() {
      return snapshot;
    },
    backupUtils: {
      buildBackupEnvelope(input) {
        return { formatVersion: 1, ...input };
      }
    },
    backupCrypto: {
      async encryptBackup(text, password) {
        return { encrypted: true, password, text };
      }
    },
    async getSettings(key, defaultValue) {
      return settings.has(key) ? settings.get(key) : defaultValue;
    },
    async setSettings(key, value) {
      settings.set(key, value);
    },
    fileHandles: {
      async save(handle) {
        storedHandle = handle;
        savedHandles.push(handle);
      },
      async get() {
        return storedHandle;
      },
      async clear() {
        storedHandle = null;
      }
    },
    document: {
      querySelector(selector) {
        assert.strictEqual(selector, '.setting-version');
        return { textContent: 'v1.5.7' };
      }
    },
    now() {
      return new Date('2026-06-25T08:00:00.000Z');
    },
    downloadText(text, filename, mimeType) {
      downloads.push({ text, filename, mimeType });
    },
    ...overrides
  };

  return {
    service: createExpenseBackupService(deps),
    settings,
    downloads,
    savedHandles,
    snapshot,
    setStoredHandle(handle) {
      storedHandle = handle;
    }
  };
}

async function testMetadataAndDownloads() {
  const harness = createHarness();
  const { service, settings, downloads, snapshot } = harness;

  assert.deepStrictEqual(await service.getBackupMeta(), DEFAULT_BACKUP_META);
  assert.notStrictEqual(await service.getBackupMeta(), DEFAULT_BACKUP_META);

  await service.setBackupMeta({
    newExpenseCount: 9,
    snoozedUntil: '2026-07-01T00:00:00.000Z'
  });
  assert.deepStrictEqual(await service.getBackupMeta(), {
    ...DEFAULT_BACKUP_META,
    newExpenseCount: 9,
    snoozedUntil: '2026-07-01T00:00:00.000Z'
  });

  const backup = await service.buildCurrentBackup();
  assert.strictEqual(backup.databaseVersion, 7);
  assert.strictEqual(backup.appVersion, '1.5.7');
  assert.deepStrictEqual(backup.expenses, snapshot.expenses);

  await service.downloadPlainBackup();
  assert.strictEqual(downloads.length, 1);
  assert.strictEqual(downloads[0].filename, 'expense-tracker-backup-2026-06-25.json');
  assert.strictEqual(downloads[0].mimeType, 'application/json;charset=utf-8');
  assert.strictEqual(JSON.parse(downloads[0].text).databaseVersion, 7);
  assert.deepStrictEqual(settings.get('backupMeta'), {
    ...DEFAULT_BACKUP_META,
    lastBackupAt: '2026-06-25T08:00:00.000Z',
    lastBackupExpenseCount: 2,
    newExpenseCount: 0,
    snoozedUntil: null
  });

  await service.setBackupMeta({ newExpenseCount: 4 });
  await service.downloadEncryptedBackup('secret');
  assert.strictEqual(downloads.length, 2);
  assert.strictEqual(
    downloads[1].filename,
    'expense-tracker-backup-2026-06-25.encrypted.json'
  );
  assert.deepStrictEqual(JSON.parse(downloads[1].text), {
    encrypted: true,
    password: 'secret',
    text: JSON.stringify(await service.buildCurrentBackup(), null, 2)
  });
  assert.strictEqual(settings.get('backupMeta').newExpenseCount, 0);
  assert.strictEqual(settings.get('backupMeta').lastBackupExpenseCount, 2);
}

async function testDownloadText() {
  const clicked = [];
  const revoked = [];
  const service = createExpenseBackupService({
    Blob: class FakeBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL(blob) {
        assert.deepStrictEqual(blob.parts, ['hello']);
        return 'blob:test';
      },
      revokeObjectURL(url) {
        revoked.push(url);
      }
    },
    document: {
      createElement(tagName) {
        assert.strictEqual(tagName, 'a');
        return {
          click() {
            clicked.push([this.href, this.download]);
          }
        };
      }
    }
  });

  service.downloadText('hello', 'backup.json', 'application/json');
  assert.deepStrictEqual(clicked, [['blob:test', 'backup.json']]);
  assert.deepStrictEqual(revoked, ['blob:test']);
}

async function testAutomaticBackupSuccess() {
  const writes = [];
  let closed = 0;
  const handle = {
    async queryPermission(options) {
      assert.deepStrictEqual(options, { mode: 'readwrite' });
      return 'granted';
    },
    async createWritable() {
      return {
        async write(text) {
          writes.push(JSON.parse(text));
        },
        async close() {
          closed += 1;
        }
      };
    }
  };
  const harness = createHarness({
    async showSaveFilePicker(options) {
      assert.strictEqual(options.suggestedName, 'expense-tracker-automatic-backup.json');
      return handle;
    }
  });

  const result = await harness.service.chooseAutomaticBackupFile();
  assert.deepStrictEqual(result, { ok: true, status: 'ready' });
  assert.strictEqual(harness.savedHandles[0], handle);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(closed, 1);
  assert.strictEqual(writes[0].expenses.length, 2);
  assert.strictEqual(
    harness.settings.get('backupMeta').automaticFileStatus,
    'ready'
  );
  assert.strictEqual(harness.settings.get('backupMeta').newExpenseCount, 0);
}

async function testAutomaticBackupFallbacks() {
  const unsupported = createHarness();
  assert.deepStrictEqual(
    await unsupported.service.chooseAutomaticBackupFile(),
    { ok: false, status: 'unsupported' }
  );
  assert.strictEqual(
    unsupported.settings.get('backupMeta').automaticFileStatus,
    'unsupported'
  );

  const deniedHandle = {
    async queryPermission() {
      return 'prompt';
    },
    async requestPermission() {
      return 'denied';
    }
  };
  const denied = createHarness();
  denied.setStoredHandle(deniedHandle);
  assert.deepStrictEqual(
    await denied.service.writeAutomaticBackup({ requestPermission: true }),
    { ok: false, status: 'permission-denied' }
  );
  assert.strictEqual(
    denied.settings.get('backupMeta').automaticFileStatus,
    'permission-denied'
  );

  const noPrompt = createHarness();
  noPrompt.setStoredHandle(deniedHandle);
  assert.deepStrictEqual(
    await noPrompt.service.writeAutomaticBackup(),
    { ok: false, status: 'permission-required' }
  );

  const missing = createHarness();
  assert.deepStrictEqual(
    await missing.service.writeAutomaticBackup(),
    { ok: false, status: 'not-configured' }
  );

  const broken = createHarness();
  broken.setStoredHandle({
    async queryPermission() {
      return 'granted';
    },
    async createWritable() {
      throw new Error('disk full');
    }
  });
  const brokenResult = await broken.service.writeAutomaticBackup();
  assert.strictEqual(brokenResult.ok, false);
  assert.strictEqual(brokenResult.status, 'write-error');
  assert.match(brokenResult.error.message, /disk full/);
  assert.strictEqual(
    broken.settings.get('backupMeta').automaticFileStatus,
    'write-error'
  );
}

async function testDebounce() {
  const timers = new Map();
  const cleared = [];
  let nextTimerId = 1;
  let writes = 0;
  const harness = createHarness({
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      timers.delete(id);
    }
  });
  harness.service.writeAutomaticBackup = async () => {
    writes += 1;
    throw new Error('must be swallowed');
  };

  harness.service.scheduleAutomaticBackup();
  harness.service.scheduleAutomaticBackup();
  assert.deepStrictEqual(cleared, [1]);
  assert.strictEqual(timers.size, 1);
  const [{ callback, delay }] = timers.values();
  assert.strictEqual(delay, 1500);
  await callback();
  assert.strictEqual(writes, 1);
}

async function testPersistentStorage() {
  const granted = createHarness({
    navigator: {
      storage: {
        async persist() {
          return true;
        }
      }
    }
  });
  assert.deepStrictEqual(
    await granted.service.requestPersistentStorage(),
    { ok: true, status: 'granted' }
  );
  assert.strictEqual(granted.settings.get('backupMeta').persistentStorage, 'granted');

  const denied = createHarness({
    navigator: {
      storage: {
        async persist() {
          return false;
        }
      }
    }
  });
  assert.deepStrictEqual(
    await denied.service.requestPersistentStorage(),
    { ok: false, status: 'denied' }
  );

  const unsupported = createHarness({ navigator: {} });
  assert.deepStrictEqual(
    await unsupported.service.requestPersistentStorage(),
    { ok: false, status: 'unsupported' }
  );
}

(async () => {
  await testMetadataAndDownloads();
  await testDownloadText();
  await testAutomaticBackupSuccess();
  await testAutomaticBackupFallbacks();
  await testDebounce();
  await testPersistentStorage();
  console.log('backup-service tests passed');
})().finally(() => {
  if (previousGlobalDescriptor) {
    Object.defineProperty(
      globalThis,
      'ExpenseBackupService',
      previousGlobalDescriptor
    );
  } else {
    delete globalThis.ExpenseBackupService;
  }
});
