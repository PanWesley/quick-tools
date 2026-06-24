const assert = require('assert');
const {
  BACKUP_FORMAT_VERSION,
  buildBackupEnvelope,
  validateBackupEnvelope,
  shouldRemindBackup,
  createExpenseFingerprint,
  planBackupMerge
} = require('./backup-utils');

const base = {
  databaseVersion: 2,
  appVersion: '1.6.0',
  exportedAt: '2026-06-24T12:00:00.000Z',
  expenses: [{ id: 'e1', date: '2026-06-01', amount: 20, note: 'Lunch', tags: ['food'] }],
  tags: [{ id: 'food', name: 'Food', parentId: 'group-category' }],
  tagGroups: [{ id: 'group-category', name: 'Category' }],
  settings: [{ key: 'currency', value: 'CNY' }],
  recurringRules: [{ id: 'r1' }],
  pendingExpenses: [{ id: 'p1' }],
  budgets: [{ id: 'b1' }]
};

const envelope = buildBackupEnvelope(base);
assert.deepStrictEqual(envelope, {
  formatVersion: BACKUP_FORMAT_VERSION,
  ...base
});
assert.strictEqual(BACKUP_FORMAT_VERSION, 1);
assert.deepStrictEqual(
  buildBackupEnvelope({
    databaseVersion: 2,
    appVersion: '1.6.0',
    exportedAt: '2026-06-24T12:00:00.000Z'
  }),
  {
    formatVersion: 1,
    databaseVersion: 2,
    appVersion: '1.6.0',
    exportedAt: '2026-06-24T12:00:00.000Z',
    expenses: [],
    tags: [],
    tagGroups: [],
    settings: [],
    recurringRules: [],
    pendingExpenses: [],
    budgets: []
  }
);
assert.deepStrictEqual(validateBackupEnvelope(envelope), { valid: true, errors: [] });

const invalidBackup = validateBackupEnvelope({
  formatVersion: 2,
  exportedAt: 'not-a-date',
  expenses: [{ id: '', date: '', amount: 'not-a-number' }],
  tags: {},
  tagGroups: null,
  settings: 'invalid'
});
assert.strictEqual(invalidBackup.valid, false);
assert.ok(invalidBackup.errors.length >= 7);
assert.deepStrictEqual(validateBackupEnvelope(null), {
  valid: false,
  errors: ['Backup must be an object']
});

const emptyAmountBackup = validateBackupEnvelope({
  ...envelope,
  expenses: [
    { id: 'empty', date: '2026-06-01', amount: '' },
    { id: 'spaces', date: '2026-06-01', amount: '   ' },
    { id: 'null', date: '2026-06-01', amount: null },
    { id: 'numeric-string', date: '2026-06-01', amount: '12.50' }
  ]
});
assert.strictEqual(emptyAmountBackup.valid, false);
assert.strictEqual(
  emptyAmountBackup.errors.filter(error => error.includes('invalid amount')).length,
  3
);

assert.deepStrictEqual(
  shouldRemindBackup({
    now: '2026-06-24T00:00:00.000Z',
    lastBackupAt: '2026-06-10T00:00:00.000Z',
    newExpenseCount: 0,
    snoozedUntil: null
  }),
  { remind: true, reason: 'age' }
);
assert.deepStrictEqual(
  shouldRemindBackup({
    now: '2026-06-24T00:00:00.000Z',
    lastBackupAt: '2026-06-23T00:00:00.000Z',
    newExpenseCount: 30,
    snoozedUntil: null
  }),
  { remind: true, reason: 'count' }
);
assert.deepStrictEqual(
  shouldRemindBackup({
    now: '2026-06-24T00:00:00.000Z',
    lastBackupAt: null,
    newExpenseCount: 1,
    snoozedUntil: null
  }),
  { remind: true, reason: 'never' }
);
assert.deepStrictEqual(
  shouldRemindBackup({
    now: '2026-06-24T00:00:00.000Z',
    lastBackupAt: null,
    newExpenseCount: 1,
    snoozedUntil: '2026-06-25T00:00:00.000Z'
  }),
  { remind: false, reason: null }
);
assert.deepStrictEqual(
  shouldRemindBackup({
    now: '2026-06-24T00:00:00.000Z',
    lastBackupAt: null,
    newExpenseCount: 0,
    snoozedUntil: null
  }),
  { remind: false, reason: null }
);

assert.strictEqual(
  createExpenseFingerprint({
    date: '2026-06-01T18:30:00.000Z',
    amount: 20,
    note: '  LUNCH   With Friends ',
    tags: ['wechat', 'food']
  }),
  createExpenseFingerprint({
    date: '2026-06-01',
    amount: '20.00',
    itemName: 'lunch with friends',
    tags: ['food', 'wechat']
  })
);

const legacyExpense = {
  date: '2026-05-31',
  amount: 8,
  note: 'Coffee',
  tags: ['food']
};
const newExpense = {
  id: 'e2',
  date: '2026-06-02',
  amount: 30,
  note: 'New',
  tags: []
};
const sameFingerprintWithNewId = {
  id: 'e3',
  ...legacyExpense
};
const mergePlan = planBackupMerge(
  {
    expenses: [
      { id: 'e1', date: '2026-06-01', amount: 20, note: 'Current', tags: [] },
      legacyExpense
    ],
    tags: [{ id: 't1', name: 'Current tag' }],
    tagGroups: [{ id: 'g1', name: 'Current group' }]
  },
  {
    expenses: [
      { id: 'e1', date: '2026-06-01', amount: 99, note: 'Backup conflict', tags: [] },
      { ...legacyExpense },
      sameFingerprintWithNewId,
      newExpense
    ],
    tags: [
      { id: 't1', name: 'Conflicting tag' },
      { id: 't2', name: 'New tag' }
    ],
    tagGroups: [
      { id: 'g1', name: 'Current group' },
      { id: 'g2', name: 'New group' }
    ]
  }
);
assert.deepStrictEqual(mergePlan.expensesToAdd, [sameFingerprintWithNewId, newExpense]);
assert.deepStrictEqual(mergePlan.tagsToAdd, [{ id: 't2', name: 'New tag' }]);
assert.deepStrictEqual(mergePlan.tagGroupsToAdd, [{ id: 'g2', name: 'New group' }]);
assert.strictEqual(mergePlan.conflicts.length, 2);
assert.strictEqual(mergePlan.conflicts[0].current.note, 'Current');
assert.strictEqual(mergePlan.conflicts[0].incoming.note, 'Backup conflict');

const reorderedRecordPlan = planBackupMerge(
  {
    expenses: [{
      id: 'same',
      date: '2026-06-03',
      amount: 15,
      metadata: { source: 'manual', flags: ['reviewed', 'shared'] }
    }]
  },
  {
    expenses: [{
      metadata: { flags: ['reviewed', 'shared'], source: 'manual' },
      amount: 15,
      date: '2026-06-03',
      id: 'same'
    }]
  }
);
assert.deepStrictEqual(reorderedRecordPlan.conflicts, []);

console.log('backup-utils tests passed');
