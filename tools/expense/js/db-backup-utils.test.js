const assert = require('assert');
const {
  normalizeDatabaseSnapshot,
  mapSnapshotRecordsToStores,
  queueTransactionWrites,
  prepareReplacementSnapshot,
  prepareMergeTransactionRecords,
  transactionComplete
} = require('./db');
const { planTagGroupRepair } = require('./tag-management-utils');
const { prepareMergedTagIntegrity } = require('./db-backup-utils');

const defaultGroups = [
  { id: 'group-category', name: 'Category' },
  { id: 'group-uncategorized', name: 'Uncategorized' }
];
const repairOptions = {
  defaultTagParentId: 'group-category',
  fallbackGroupId: 'group-uncategorized'
};

const replacement = prepareReplacementSnapshot({
  expenses: [{ id: 'expense-1' }],
  tags: [
    { id: 'tag-missing-parent', name: 'Missing parent' },
    { id: 'tag-invalid-parent', name: 'Invalid parent', parentId: 'deleted-group' }
  ],
  settings: [],
  tagGroups: []
}, planTagGroupRepair, defaultGroups, repairOptions);

assert.deepStrictEqual(replacement.tagGroups, defaultGroups);
assert.deepStrictEqual(replacement.tags, [
  { id: 'tag-missing-parent', name: 'Missing parent', parentId: 'group-category' },
  {
    id: 'tag-invalid-parent',
    name: 'Invalid parent',
    parentId: 'group-uncategorized'
  }
]);

const mergeRecords = prepareMergeTransactionRecords({
  currentTags: [
    { id: 'tag-existing', name: 'Existing', parentId: 'deleted-group' }
  ],
  currentTagGroups: [
    { id: 'group-category', name: 'Category' }
  ],
  expensesToAdd: [{ id: 'expense-new' }],
  tagsToAdd: [
    { id: 'tag-new', name: 'New' }
  ],
  tagGroupsToAdd: []
}, planTagGroupRepair, defaultGroups, repairOptions);

assert.deepStrictEqual(mergeRecords.expenses, [{ id: 'expense-new' }]);
assert.deepStrictEqual(mergeRecords.tagGroups, [
  { id: 'group-uncategorized', name: 'Uncategorized' }
]);
assert.deepStrictEqual(mergeRecords.tags, [
  { id: 'tag-new', name: 'New' },
  {
    id: 'tag-existing',
    name: 'Existing',
    parentId: 'group-uncategorized'
  },
  {
    id: 'tag-new',
    name: 'New',
    parentId: 'group-category'
  }
]);

assert.deepStrictEqual(
  prepareMergedTagIntegrity({
    currentTags: [
      { id: 'tag-existing', name: 'Existing', parentId: 'deleted-group' }
    ],
    currentTagGroups: [
      { id: 'group-category', name: 'Category' }
    ],
    tagsToAdd: [
      { id: 'tag-new', name: 'New' }
    ],
    tagGroupsToAdd: []
  }, planTagGroupRepair, defaultGroups, repairOptions),
  {
    tags: [
      {
        id: 'tag-existing',
        name: 'Existing',
        parentId: 'group-uncategorized'
      },
      {
        id: 'tag-new',
        name: 'New',
        parentId: 'group-category'
      }
    ],
    tagGroups: [
      { id: 'group-category', name: 'Category' },
      { id: 'group-uncategorized', name: 'Uncategorized' }
    ]
  }
);

function createFakeTransaction(storeDefinitions, abortError) {
  const calls = [];
  const stores = Object.fromEntries(
    Object.entries(storeDefinitions).map(([storeName, definition]) => [
      storeName,
      {
        clear() {
          calls.push(['clear', storeName]);
          if (definition.clearError) throw definition.clearError;
        },
        put(record) {
          calls.push(['put', storeName, record]);
          if (definition.putError) throw definition.putError;
        }
      }
    ])
  );

  return {
    calls,
    aborted: false,
    objectStore(storeName) {
      return stores[storeName];
    },
    abort() {
      this.aborted = true;
      calls.push(['abort']);
      if (abortError) throw abortError;
    }
  };
}

const cloneError = new Error('DataCloneError');
const replaceTx = createFakeTransaction({
  expenses: {},
  tags: { putError: cloneError }
});
assert.throws(
  () => queueTransactionWrites(replaceTx, {
    expenses: [{ id: 'expense-1' }],
    tags: [{ id: 'tag-1' }]
  }, { clear: true }),
  error => error === cloneError
);
assert.strictEqual(replaceTx.aborted, true);
assert.deepStrictEqual(replaceTx.calls, [
  ['clear', 'expenses'],
  ['put', 'expenses', { id: 'expense-1' }],
  ['clear', 'tags'],
  ['put', 'tags', { id: 'tag-1' }],
  ['abort']
]);

const dataError = new Error('DataError');
const mergeTx = createFakeTransaction({
  expenses: { putError: dataError }
}, new Error('AbortError'));
assert.throws(
  () => queueTransactionWrites(mergeTx, {
    expenses: [{ id: 'expense-1' }]
  }),
  error => error === dataError
);
assert.strictEqual(mergeTx.aborted, true);

const normalized = normalizeDatabaseSnapshot({
  expenses: [{ id: 'expense-1' }, undefined, { amount: 10 }],
  tags: [{ id: 'tag-1' }, { name: 'Missing id' }],
  settings: [{ key: 'currency', value: 'CNY' }, { value: 'Missing key' }],
  tagGroups: [{ id: 'group-1' }, { name: 'Missing id' }]
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

(async () => {
  const events = [];
  const asyncAbortTx = {
    error: new Error('late transaction error'),
    abort() {
      queueMicrotask(() => {
        events.push('abort');
        this.onabort();
        events.push('error');
        this.onerror();
      });
    }
  };
  const completion = transactionComplete(asyncAbortTx);
  asyncAbortTx.abort();

  await assert.rejects(completion, /Transaction aborted/);
  assert.deepStrictEqual(events, ['abort', 'error']);

  console.log('db-backup-utils tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
