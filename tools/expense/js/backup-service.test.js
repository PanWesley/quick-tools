const assert = require('assert');

const previousGlobalDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'ExpenseBackupService'
);
delete globalThis.ExpenseBackupService;

const { createExpenseBackupService, DEFAULT_BACKUP_META } = require('./backup-service');
const backupUtils = require('./backup-utils');
const backupCrypto = require('./backup-crypto');
const {
  prepareMergeExpected,
  prepareReplacementTagIntegrity
} = require('./db-backup-utils');
const { planTagGroupRepair } = require('./tag-management-utils');

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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createValidBackup(overrides = {}) {
  return {
    formatVersion: 1,
    databaseVersion: 2,
    appVersion: '1.6.0',
    exportedAt: '2026-06-25T08:00:00.000Z',
    expenses: [],
    tags: [],
    tagGroups: [],
    settings: [],
    ...overrides
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRestoreHarness(options = {}) {
  let state = clone(options.current || createValidBackup());
  let snapshotCalls = 0;
  const replaceCalls = [];
  const mergePlans = [];
  const metadataWrites = [];
  const mergeExpected = Object.prototype.hasOwnProperty.call(
    options,
    'prepareMergeExpected'
  )
    ? options.prepareMergeExpected
    : (current, plan) => ({
      tags: [...current.tags, ...plan.tagsToAdd],
      tagGroups: [...current.tagGroups, ...plan.tagGroupsToAdd]
    });
  const replacementExpected = Object.prototype.hasOwnProperty.call(
    options,
    'prepareReplacementExpected'
  )
    ? options.prepareReplacementExpected
    : snapshot => snapshot;
  const service = createExpenseBackupService({
    backupUtils,
    backupCrypto,
    prepareMergeExpected: mergeExpected,
    prepareReplacementExpected: replacementExpected,
    async createDatabaseSnapshot() {
      snapshotCalls += 1;
      if (typeof options.onSnapshot === 'function') {
        const result = await options.onSnapshot({
          call: snapshotCalls,
          state: clone(state)
        });
        if (result !== undefined) return clone(result);
      }
      return clone(state);
    },
    async replaceDatabaseSnapshot(snapshot) {
      replaceCalls.push(clone(snapshot));
      if (typeof options.onReplace === 'function') {
        await options.onReplace({
          call: replaceCalls.length,
          snapshot: clone(snapshot),
          setState(value) {
            state = clone(value);
          }
        });
        return;
      }
      state = clone(snapshot);
    },
    async applyBackupMergePlan(plan) {
      mergePlans.push(clone(plan));
      if (typeof options.onMerge === 'function') {
        await options.onMerge({
          call: mergePlans.length,
          plan: clone(plan),
          state: clone(state),
          setState(value) {
            state = clone(value);
          }
        });
        return;
      }
      state.expenses.push(...clone(plan.expensesToAdd));
      state.tags.push(...clone(plan.tagsToAdd));
      state.tagGroups.push(...clone(plan.tagGroupsToAdd));
    },
    async getSettings() {
      return null;
    },
    async setSettings(key, value) {
      metadataWrites.push({ key, value: clone(value) });
      if (options.metadataError) throw options.metadataError;
    },
    now() {
      return new Date('2026-06-25T08:00:00.000Z');
    }
  });

  return {
    service,
    replaceCalls,
    mergePlans,
    metadataWrites,
    getState() {
      return clone(state);
    }
  };
}

async function testBackupParsing() {
  const service = createExpenseBackupService({
    backupUtils,
    backupCrypto
  });
  const plainBackup = createValidBackup({
    expenses: [{ id: 'expense-1', date: '2026-06-25', amount: 12 }]
  });

  assert.deepStrictEqual(
    await service.parseBackupText(JSON.stringify(plainBackup)),
    {
      encrypted: false,
      requiresPassword: false,
      backup: plainBackup
    }
  );

  const encryptedEnvelope = await backupCrypto.encryptBackup(
    JSON.stringify(plainBackup),
    'correct-password'
  );
  assert.deepStrictEqual(
    await service.parseBackupText(JSON.stringify(encryptedEnvelope)),
    { encrypted: true, requiresPassword: true }
  );
  assert.deepStrictEqual(
    await service.parseBackupText(
      JSON.stringify(encryptedEnvelope),
      'correct-password'
    ),
    {
      encrypted: true,
      requiresPassword: false,
      backup: plainBackup
    }
  );
  await assert.rejects(
    service.parseBackupText(JSON.stringify(encryptedEnvelope), 'wrong-password'),
    /密码错误或加密备份已损坏/
  );
  const missingDecryptService = createExpenseBackupService({
    backupUtils,
    backupCrypto: {
      isEncryptedBackup: backupCrypto.isEncryptedBackup
    }
  });
  await assert.rejects(
    missingDecryptService.parseBackupText(
      JSON.stringify(encryptedEnvelope),
      'correct-password'
    ),
    /加密备份功能未加载/
  );
  await assert.rejects(
    service.parseBackupText(JSON.stringify({
      format: 'expense-tracker-encrypted-backup',
      version: 999,
      kdf: {},
      cipher: {}
    }), 'password'),
    /加密备份格式不受支持或已损坏/
  );
  await assert.rejects(
    service.parseBackupText('{broken-json'),
    /备份文件不是有效 JSON/
  );
  await assert.rejects(
    service.parseBackupText(JSON.stringify(createValidBackup({
      formatVersion: 2
    }))),
    /newer app version/
  );
}

async function testInspectBackupFile() {
  let textCalls = 0;
  const current = createValidBackup({
    expenses: [{ id: 'current', date: '2026-06-24', amount: 10 }],
    tags: [{ id: 'current-tag', name: 'Current' }]
  });
  const incoming = createValidBackup({
    expenses: [
      { id: 'current', date: '2026-06-24', amount: 99 },
      { id: 'incoming', date: '2026-06-25', amount: 20 }
    ],
    tags: [{ id: 'incoming-tag', name: 'Incoming' }]
  });
  const service = createExpenseBackupService({
    backupUtils,
    backupCrypto,
    async createDatabaseSnapshot() {
      return current;
    }
  });
  const result = await service.inspectBackupFile({
    async text() {
      textCalls += 1;
      return JSON.stringify(incoming);
    }
  });

  assert.strictEqual(textCalls, 1);
  assert.deepStrictEqual(result, {
    encrypted: false,
    requiresPassword: false,
    backup: incoming,
    summary: {
      expenseCount: 2,
      tagCount: 1,
      conflictCount: 1,
      newExpenseCount: 1
    }
  });
}

async function testRestoreBackup() {
  const current = createValidBackup({
    expenses: [{ id: 'current', date: '2026-06-24', amount: 10 }],
    tags: [{ id: 'current-tag', name: 'Current', parentId: 'group-category' }],
    tagGroups: [{ id: 'group-category', name: 'Category' }],
    settings: [{ key: 'currency', value: 'CNY' }]
  });
  const replacement = createValidBackup({
    expenses: [{ id: 'replacement', date: '2026-06-25', amount: 20 }],
    tags: [{ id: 'replacement-tag', name: 'Replacement', parentId: 'group-new' }],
    tagGroups: [{ id: 'group-new', name: 'New group' }],
    settings: [{ key: 'currency', value: 'USD' }]
  });
  const replaceHarness = createRestoreHarness({ current });
  const replaceResult = await replaceHarness.service.restoreBackup(
    replacement,
    'replace'
  );
  assert.deepStrictEqual(replaceHarness.getState(), replacement);
  assert.strictEqual(replaceHarness.replaceCalls.length, 1);
  assert.deepStrictEqual(replaceHarness.metadataWrites[0].value, {
    ...DEFAULT_BACKUP_META,
    lastBackupAt: '2026-06-25T08:00:00.000Z',
    lastBackupExpenseCount: 1,
    newExpenseCount: 0,
    snoozedUntil: null
  });
  assert.deepStrictEqual(replaceResult, {
    restored: true,
    mode: 'replace',
    snapshot: replacement,
    summary: {
      expenseCount: 1,
      tagCount: 1,
      conflictCount: 0,
      newExpenseCount: 1
    }
  });

  const repairReplacement = createValidBackup({
    expenses: [{ id: 'replace-repair', date: '2026-06-25', amount: 20 }],
    tags: [
      { id: 'replace-missing', name: 'Missing parent' },
      {
        id: 'replace-invalid',
        name: 'Invalid parent',
        parentId: 'deleted-group'
      }
    ],
    tagGroups: [],
    settings: [{ key: 'currency', value: 'CNY' }]
  });
  const repairedReplaceHarness = createRestoreHarness({
    current,
    prepareReplacementExpected: prepareReplacementTagIntegrity,
    async onReplace({ snapshot, setState }) {
      setState(prepareReplacementTagIntegrity(snapshot));
    }
  });
  const repairedReplaceResult = await repairedReplaceHarness.service
    .restoreBackup(repairReplacement, 'replace');
  assert.strictEqual(repairedReplaceResult.restored, true);
  assert.strictEqual(repairedReplaceHarness.replaceCalls.length, 1);
  assert.deepStrictEqual(
    repairedReplaceHarness.getState(),
    prepareReplacementTagIntegrity(repairReplacement)
  );

  const rogueReplaceGroup = createRestoreHarness({
    current,
    prepareReplacementExpected: prepareReplacementTagIntegrity,
    async onReplace({ call, snapshot, setState }) {
      if (call > 1) {
        setState(snapshot);
        return;
      }
      const prepared = prepareReplacementTagIntegrity(snapshot);
      setState({
        ...prepared,
        tagGroups: [
          ...prepared.tagGroups,
          { id: 'rogue-replace-group', name: 'Rogue' }
        ]
      });
    }
  });
  await assert.rejects(
    rogueReplaceGroup.service.restoreBackup(repairReplacement, 'replace'),
    /tagGroups.*content/i
  );
  assert.deepStrictEqual(rogueReplaceGroup.getState(), current);
  assert.strictEqual(rogueReplaceGroup.replaceCalls.length, 2);

  const mergeIncoming = createValidBackup({
    expenses: [
      { id: 'current', date: '2026-06-24', amount: 999 },
      { id: 'merged', date: '2026-06-25', amount: 30 }
    ],
    tags: [{ id: 'merged-tag', name: 'Merged', parentId: 'group-category' }],
    tagGroups: [{ id: 'group-category', name: 'Category' }],
    settings: []
  });
  const mergeHarness = createRestoreHarness({ current });
  const mergeResult = await mergeHarness.service.restoreBackup(
    mergeIncoming,
    'merge'
  );
  assert.strictEqual(mergeHarness.replaceCalls.length, 0);
  assert.strictEqual(mergeHarness.mergePlans.length, 1);
  assert.strictEqual(mergeHarness.getState().expenses[0].amount, 10);
  assert.deepStrictEqual(
    mergeHarness.getState().expenses.map(expense => expense.id),
    ['current', 'merged']
  );
  assert.deepStrictEqual(mergeResult.summary, {
    expenseCount: 2,
    tagCount: 1,
    conflictCount: 1,
    newExpenseCount: 1
  });

  const missingIntegrityDependency = createRestoreHarness({
    current,
    prepareMergeExpected: null
  });
  await assert.rejects(
    missingIntegrityDependency.service.restoreBackup(mergeIncoming, 'merge'),
    /备份完整性依赖未加载/
  );
  assert.deepStrictEqual(missingIntegrityDependency.getState(), current);
  assert.strictEqual(missingIntegrityDependency.mergePlans.length, 0);
  assert.strictEqual(missingIntegrityDependency.replaceCalls.length, 0);

  const sharedIdCurrent = createValidBackup({
    expenses: [{ id: 'shared-id', date: '2026-06-24', amount: 10 }],
    tags: [{
      id: 'shared-id',
      name: 'Current tag',
      parentId: 'group-category'
    }],
    tagGroups: [{ id: 'group-category', name: 'Category' }],
    settings: []
  });
  const sharedIdIncoming = createValidBackup({
    expenses: [{ id: 'shared-id', date: '2026-06-24', amount: 999 }],
    tags: [{
      id: 'shared-id',
      name: 'Incoming tag',
      parentId: 'group-category'
    }],
    tagGroups: [{ id: 'group-category', name: 'Category' }],
    settings: []
  });
  const sharedIdMerge = createRestoreHarness({ current: sharedIdCurrent });
  const sharedIdResult = await sharedIdMerge.service.restoreBackup(
    sharedIdIncoming,
    'merge'
  );
  assert.strictEqual(sharedIdResult.restored, true);
  assert.strictEqual(sharedIdResult.summary.conflictCount, 2);
  assert.deepStrictEqual(sharedIdMerge.getState(), sharedIdCurrent);
  assert.strictEqual(sharedIdMerge.replaceCalls.length, 0);

  const mergeContentFailure = createRestoreHarness({
    current,
    async onMerge({ state, setState }) {
      setState({
        ...state,
        expenses: [
          ...state.expenses,
          { id: 'wrong-expense', date: '2026-06-25', amount: 30 }
        ],
        tags: [
          ...state.tags,
          { id: 'wrong-tag', name: 'Wrong', parentId: 'group-category' }
        ],
        tagGroups: [
          ...state.tagGroups,
          { id: 'wrong-group', name: 'Wrong group' }
        ]
      });
    }
  });
  await assert.rejects(
    mergeContentFailure.service.restoreBackup(mergeIncoming, 'merge'),
    /expenses.*content/i
  );
  assert.deepStrictEqual(mergeContentFailure.getState(), current);
  assert.strictEqual(mergeContentFailure.replaceCalls.length, 1);

  const noConflictIncoming = createValidBackup({
    expenses: [{ id: 'new-only', date: '2026-06-25', amount: 40 }],
    tags: [],
    tagGroups: [],
    settings: []
  });
  const originalContentFailure = createRestoreHarness({
    current,
    async onMerge({ plan, state, setState }) {
      setState({
        ...state,
        expenses: [
          { ...state.expenses[0], amount: 777 },
          ...plan.expensesToAdd
        ],
        tags: [...state.tags, ...plan.tagsToAdd],
        tagGroups: [...state.tagGroups, ...plan.tagGroupsToAdd]
      });
    }
  });
  await assert.rejects(
    originalContentFailure.service.restoreBackup(noConflictIncoming, 'merge'),
    /expenses.*content/i
  );
  assert.deepStrictEqual(originalContentFailure.getState(), current);
  assert.strictEqual(originalContentFailure.replaceCalls.length, 1);

  const rogueExpenseFailure = createRestoreHarness({
    current,
    async onMerge({ plan, state, setState }) {
      setState({
        ...state,
        expenses: [
          ...state.expenses,
          ...plan.expensesToAdd,
          { id: 'rogue-expense', date: '2026-06-25', amount: 999 }
        ],
        tags: [...state.tags, ...plan.tagsToAdd],
        tagGroups: [...state.tagGroups, ...plan.tagGroupsToAdd]
      });
    }
  });
  await assert.rejects(
    rogueExpenseFailure.service.restoreBackup(noConflictIncoming, 'merge'),
    /expenses.*content/i
  );
  assert.deepStrictEqual(rogueExpenseFailure.getState(), current);
  assert.strictEqual(rogueExpenseFailure.replaceCalls.length, 1);

  const rogueTagGroupFailure = createRestoreHarness({
    current,
    async onMerge({ plan, state, setState }) {
      setState({
        ...state,
        expenses: [...state.expenses, ...plan.expensesToAdd],
        tags: [
          ...state.tags,
          ...plan.tagsToAdd,
          { id: 'rogue-tag', name: 'Rogue', parentId: 'rogue-group' }
        ],
        tagGroups: [
          ...state.tagGroups,
          ...plan.tagGroupsToAdd,
          { id: 'rogue-group', name: 'Rogue group' }
        ]
      });
    }
  });
  await assert.rejects(
    rogueTagGroupFailure.service.restoreBackup(noConflictIncoming, 'merge'),
    /tags.*content|tagGroups.*content/i
  );
  assert.deepStrictEqual(rogueTagGroupFailure.getState(), current);
  assert.strictEqual(rogueTagGroupFailure.replaceCalls.length, 1);

  const repairCurrent = createValidBackup({
    expenses: [],
    tags: [{
      id: 'existing-invalid',
      name: 'Existing invalid',
      parentId: 'deleted-group'
    }],
    tagGroups: [{ id: 'group-category', name: 'Category' }],
    settings: [{ key: 'currency', value: 'CNY' }]
  });
  const repairIncoming = createValidBackup({
    expenses: [],
    tags: [{ id: 'new-missing-parent', name: 'New missing parent' }],
    tagGroups: [],
    settings: []
  });
  const repairHarness = createRestoreHarness({
    current: repairCurrent,
    prepareMergeExpected(currentSnapshot, plan) {
      return prepareMergeExpected(currentSnapshot, plan, planTagGroupRepair);
    },
    async onMerge({ plan, state, setState }) {
      const repaired = prepareMergeExpected(state, plan, planTagGroupRepair);
      setState({
        ...state,
        expenses: [...state.expenses, ...plan.expensesToAdd],
        tags: repaired.tags,
        tagGroups: repaired.tagGroups
      });
    }
  });
  const repairResult = await repairHarness.service.restoreBackup(
    repairIncoming,
    'merge'
  );
  assert.strictEqual(repairResult.restored, true);
  assert.strictEqual(repairHarness.replaceCalls.length, 0);
  assert.deepStrictEqual(repairHarness.getState().tags, [
    {
      id: 'existing-invalid',
      name: 'Existing invalid',
      parentId: 'group-uncategorized'
    },
    {
      id: 'new-missing-parent',
      name: 'New missing parent',
      parentId: 'group-category'
    }
  ]);
  assert.deepStrictEqual(repairHarness.getState().tagGroups, [
    { id: 'group-category', name: 'Category' },
    { id: 'group-payment', name: '支付方式', color: '#3498db', order: 0 },
    { id: 'group-person', name: '人员', color: '#e91e63', order: 1 },
    { id: 'group-channel', name: '渠道', color: '#9b59b6', order: 3 },
    {
      id: 'group-uncategorized',
      name: '未分类',
      color: '#95a5a6',
      order: 99
    }
  ]);

  const writeFailure = createRestoreHarness({
    current,
    async onReplace({ call, snapshot, setState }) {
      if (call === 1) {
        setState(snapshot);
        throw new Error('write failed');
      }
      setState(snapshot);
    }
  });
  await assert.rejects(
    writeFailure.service.restoreBackup(replacement, 'replace'),
    /write failed/
  );
  assert.deepStrictEqual(writeFailure.getState(), current);
  assert.strictEqual(writeFailure.replaceCalls.length, 2);

  const verificationFailure = createRestoreHarness({
    current,
    async onReplace({ snapshot, setState }) {
      setState(snapshot);
    },
    async onSnapshot({ call, state }) {
      if (call === 2) {
        return {
          ...state,
          tagGroups: []
        };
      }
    }
  });
  await assert.rejects(
    verificationFailure.service.restoreBackup(replacement, 'replace'),
    /reference|parent/i
  );
  assert.deepStrictEqual(verificationFailure.getState(), current);
  assert.strictEqual(verificationFailure.replaceCalls.length, 2);

  const sameCountContentFailure = createRestoreHarness({
    current,
    async onReplace({ snapshot, setState }) {
      setState(snapshot);
    },
    async onSnapshot({ call, state }) {
      if (call === 2) {
        return {
          ...state,
          expenses: [{
            ...state.expenses[0],
            amount: 999
          }]
        };
      }
    }
  });
  await assert.rejects(
    sameCountContentFailure.service.restoreBackup(replacement, 'replace'),
    /expenses content/i
  );
  assert.deepStrictEqual(sameCountContentFailure.getState(), current);
  assert.strictEqual(sameCountContentFailure.replaceCalls.length, 2);

  const originalRestoreError = new Error('primary write failure');
  const originalRollbackError = new Error('rollback storage failure');
  const rollbackFailure = createRestoreHarness({
    current,
    async onReplace({ call, snapshot, setState }) {
      if (call === 1) {
        setState(snapshot);
        throw originalRestoreError;
      }
      throw originalRollbackError;
    }
  });
  await assert.rejects(
    rollbackFailure.service.restoreBackup(replacement, 'replace'),
    error => {
      assert.strictEqual(error.cause, originalRestoreError);
      assert.strictEqual(error.rollbackError, originalRollbackError);
      if (typeof AggregateError === 'function') {
        assert.ok(error instanceof AggregateError);
        assert.deepStrictEqual(error.errors, [
          originalRestoreError,
          originalRollbackError
        ]);
      }
      assert.match(error.message, /primary write failure/);
      assert.match(error.message, /rollback storage failure/);
      return true;
    }
  );

  const unknownMode = createRestoreHarness({ current });
  await assert.rejects(
    unknownMode.service.restoreBackup(replacement, 'append'),
    /Unknown restore mode/
  );
  assert.deepStrictEqual(unknownMode.getState(), current);
  assert.strictEqual(unknownMode.replaceCalls.length, 0);
  assert.strictEqual(unknownMode.mergePlans.length, 0);

  const metadataFailure = createRestoreHarness({
    current,
    metadataError: new Error('metadata failed')
  });
  const metadataResult = await metadataFailure.service.restoreBackup(
    replacement,
    'replace'
  );
  assert.deepStrictEqual(metadataFailure.getState(), replacement);
  assert.strictEqual(metadataFailure.replaceCalls.length, 1);
  assert.match(metadataResult.metadataWarning.message, /metadata failed/);
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

  await service.markBackupSuccessful(7);
  assert.strictEqual(settings.get('backupMeta').lastBackupExpenseCount, 7);
}

async function testDownloadText() {
  const events = [];
  const cleanups = [];
  let attached = false;
  let removed = false;
  let revoked = false;
  const link = {
    click() {
      assert.strictEqual(attached, true);
      assert.strictEqual(revoked, false);
      events.push('click');
    },
    remove() {
      removed = true;
      attached = false;
      events.push('remove');
    }
  };
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
        assert.strictEqual(url, 'blob:test');
        revoked = true;
        events.push('revoke');
      }
    },
    document: {
      body: {
        appendChild(node) {
          assert.strictEqual(node, link);
          attached = true;
          events.push('append');
        }
      },
      createElement(tagName) {
        assert.strictEqual(tagName, 'a');
        return link;
      }
    },
    scheduleCleanup(callback, delay) {
      assert.strictEqual(delay, 0);
      cleanups.push(callback);
    }
  });

  service.downloadText('hello', 'backup.json', 'application/json');
  assert.strictEqual(link.href, 'blob:test');
  assert.strictEqual(link.download, 'backup.json');
  assert.strictEqual(removed, true);
  assert.strictEqual(revoked, false);
  assert.deepStrictEqual(events, ['append', 'click', 'remove']);
  assert.strictEqual(cleanups.length, 1);
  cleanups[0]();
  assert.strictEqual(revoked, true);
  assert.deepStrictEqual(events, ['append', 'click', 'remove', 'revoke']);
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
  assert.deepStrictEqual(result, {
    supported: true,
    handle,
    ok: true,
    status: 'ready',
    written: true
  });
  const task7CompatibleHandle = result.supported ? result.handle : null;
  assert.strictEqual(task7CompatibleHandle, handle);
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
    { supported: false }
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
    { ok: false, status: 'permission-denied', written: false }
  );
  assert.strictEqual(
    denied.settings.get('backupMeta').automaticFileStatus,
    'permission-denied'
  );

  const noPrompt = createHarness();
  noPrompt.setStoredHandle(deniedHandle);
  assert.deepStrictEqual(
    await noPrompt.service.writeAutomaticBackup(),
    { ok: false, status: 'permission-required', written: false }
  );

  const missing = createHarness();
  assert.deepStrictEqual(
    await missing.service.writeAutomaticBackup(),
    { ok: false, status: 'not-configured', written: false }
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
  assert.strictEqual(brokenResult.written, false);
  assert.match(brokenResult.error.message, /disk full/);
  assert.strictEqual(
    broken.settings.get('backupMeta').automaticFileStatus,
    'write-error'
  );
}

async function testAutomaticBackupMetadataWarning() {
  const handle = {
    async queryPermission() {
      return 'granted';
    },
    async createWritable() {
      return {
        async write() {},
        async close() {}
      };
    }
  };
  const harness = createHarness({
    async setSettings() {
      throw new Error('metadata unavailable');
    }
  });
  harness.setStoredHandle(handle);

  const result = await harness.service.writeAutomaticBackup();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.written, true);
  assert.match(result.metadataWarning.message, /metadata unavailable/);
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
    },
    onAutomaticBackupResult() {}
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

async function testAutomaticBackupCoalescesWhileWriting() {
  const timers = new Map();
  let nextTimerId = 1;
  const first = createDeferred();
  const second = createDeferred();
  const deferredWrites = [first, second];
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const completions = [];
  const harness = createHarness({
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    onAutomaticBackupResult() {}
  });
  harness.service.writeAutomaticBackup = async () => {
    const call = calls++;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await deferredWrites[call].promise;
    active -= 1;
    completions.push(call + 1);
    return { ok: true, written: true, status: 'ready', call: call + 1 };
  };

  harness.service.scheduleAutomaticBackup();
  const [{ callback }] = timers.values();
  const scheduledRun = callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(calls, 1);

  harness.service.scheduleAutomaticBackup();
  assert.strictEqual(timers.size, 1);
  assert.strictEqual(calls, 1);

  first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(calls, 2);
  assert.strictEqual(maxActive, 1);
  assert.deepStrictEqual(completions, [1]);

  second.resolve();
  await scheduledRun;
  assert.strictEqual(maxActive, 1);
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(completions, [1, 2]);
}

async function testChooseWaitsForScheduledWriteQueue() {
  const timers = [];
  const firstClose = createDeferred();
  const writes = [];
  let active = 0;
  let maxActive = 0;
  let snapshotNumber = 0;

  function createHandle(name, closeGate) {
    return {
      name,
      async queryPermission() {
        return 'granted';
      },
      async createWritable() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        return {
          async write(text) {
            writes.push({ handle: name, backup: JSON.parse(text) });
          },
          async close() {
            if (closeGate) await closeGate.promise;
            active -= 1;
          }
        };
      }
    };
  }

  const oldHandle = createHandle('old.json', firstClose);
  const newHandle = createHandle('new.json');
  const harness = createHarness({
    async createDatabaseSnapshot() {
      snapshotNumber += 1;
      return {
        metadata: { databaseVersion: 7 },
        expenses: [{ id: `expense-${snapshotNumber}` }],
        tags: [],
        tagGroups: [],
        settings: []
      };
    },
    async showSaveFilePicker() {
      return newHandle;
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    onAutomaticBackupResult() {}
  });
  harness.setStoredHandle(oldHandle);

  harness.service.scheduleAutomaticBackup();
  const scheduledWrite = timers.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].handle, 'old.json');
  assert.strictEqual(writes[0].backup.expenses[0].id, 'expense-1');

  const chosenWrite = harness.service.chooseAutomaticBackupFile();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(maxActive, 1);
  assert.strictEqual(writes.length, 1);

  firstClose.resolve();
  const chooseResult = await chosenWrite;
  await scheduledWrite;

  assert.strictEqual(maxActive, 1);
  assert.strictEqual(writes.length, 2);
  assert.strictEqual(writes[1].handle, 'new.json');
  assert.strictEqual(writes[1].backup.expenses[0].id, 'expense-2');
  assert.strictEqual(chooseResult.handle, newHandle);
  assert.strictEqual(chooseResult.written, true);
}

async function testAutomaticBackupResultsAreObservable() {
  const timers = [];
  const observed = [];
  const harness = createHarness({
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    onAutomaticBackupResult(result) {
      observed.push(result);
    }
  });

  harness.service.writeAutomaticBackup = async () => ({
    ok: false,
    written: false,
    status: 'permission-denied'
  });
  harness.service.scheduleAutomaticBackup();
  await timers.shift()();
  assert.deepStrictEqual(observed.shift(), {
    ok: false,
    written: false,
    status: 'permission-denied'
  });

  harness.service.writeAutomaticBackup = async () => {
    throw new Error('unexpected automatic failure');
  };
  harness.service.scheduleAutomaticBackup();
  await timers.shift()();
  assert.strictEqual(observed[0].ok, false);
  assert.strictEqual(observed[0].written, false);
  assert.strictEqual(observed[0].status, 'unexpected-error');
  assert.match(observed[0].error.message, /unexpected automatic failure/);
}

async function testAutomaticBackupDefaultsToWarning() {
  const timers = [];
  const warnings = [];
  const harness = createHarness({
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    console: {
      warn(...args) {
        warnings.push(args);
      }
    }
  });
  harness.service.writeAutomaticBackup = async () => ({
    ok: true,
    written: false,
    status: 'not-configured'
  });

  harness.service.scheduleAutomaticBackup();
  await timers.shift()();
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0][0], /Automatic backup/);
  assert.strictEqual(warnings[0][1].status, 'not-configured');
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

  const metadataFailure = createHarness({
    navigator: {
      storage: {
        async persist() {
          return true;
        }
      }
    },
    async setSettings() {
      throw new Error('persistent metadata unavailable');
    }
  });
  const metadataFailureResult = await metadataFailure.service
    .requestPersistentStorage();
  assert.strictEqual(metadataFailureResult.ok, true);
  assert.strictEqual(metadataFailureResult.status, 'granted');
  assert.match(
    metadataFailureResult.metadataWarning.message,
    /persistent metadata unavailable/
  );
}

(async () => {
  await testBackupParsing();
  await testInspectBackupFile();
  await testRestoreBackup();
  await testMetadataAndDownloads();
  await testDownloadText();
  await testAutomaticBackupSuccess();
  await testAutomaticBackupFallbacks();
  await testAutomaticBackupMetadataWarning();
  await testDebounce();
  await testAutomaticBackupCoalescesWhileWriting();
  await testChooseWaitsForScheduledWriteQueue();
  await testAutomaticBackupResultsAreObservable();
  await testAutomaticBackupDefaultsToWarning();
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
