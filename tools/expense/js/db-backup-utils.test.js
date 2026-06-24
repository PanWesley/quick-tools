const assert = require('assert');
const {
  normalizeDatabaseSnapshot,
  mapSnapshotRecordsToStores
} = require('./db');

const normalized = normalizeDatabaseSnapshot({
  expenses: [{ id: 'expense-1' }, undefined],
  tags: [{ id: 'tag-1' }],
  settings: [{ key: 'currency', value: 'CNY' }],
  tagGroups: [{ id: 'group-1' }]
});

assert.deepStrictEqual(normalized, {
  expenses: [{ id: 'expense-1' }],
  tags: [{ id: 'tag-1' }],
  settings: [{ key: 'currency', value: 'CNY' }],
  tagGroups: [{ id: 'group-1' }]
});

assert.deepStrictEqual(normalizeDatabaseSnapshot({}), {
  expenses: [],
  tags: [],
  settings: [],
  tagGroups: []
});

assert.throws(
  () => normalizeDatabaseSnapshot({ expenses: {} }),
  /expenses must be an array/
);
assert.throws(
  () => normalizeDatabaseSnapshot(null),
  /Snapshot must be an object/
);

assert.deepStrictEqual(
  mapSnapshotRecordsToStores(normalized, {
    expenses: 'expenseStore',
    tags: 'tagStore',
    settings: 'settingStore',
    tagGroups: 'groupStore'
  }),
  {
    expenseStore: normalized.expenses,
    tagStore: normalized.tags,
    settingStore: normalized.settings,
    groupStore: normalized.tagGroups
  }
);

console.log('db-backup-utils tests passed');
