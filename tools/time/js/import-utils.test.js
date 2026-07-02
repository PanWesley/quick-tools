const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateImportPayload,
  summarizeImportPayload,
  mergeRecords,
  buildImportResult
} = require('./import-utils.js');

test('validateImportPayload accepts today-youxu version 1 payloads', () => {
  const result = validateImportPayload({ app: 'today-youxu', version: 1 });
  assert.equal(result.valid, true);
});

test('validateImportPayload rejects wrong app or version', () => {
  assert.equal(validateImportPayload({ app: 'other', version: 1 }).valid, false);
  assert.equal(validateImportPayload({ app: 'today-youxu', version: 2 }).valid, false);
});

test('summarizeImportPayload counts all supported stores', () => {
  const summary = summarizeImportPayload({
    app: 'today-youxu',
    version: 1,
    tasks: [{ id: 'task_1' }],
    habits: [{ id: 'habit_1' }],
    habitLogs: [{ id: 'log_1' }],
    journals: [{ id: 'journal_1' }],
    opLogs: [{ id: 'op_1' }]
  });

  assert.deepEqual(summary, {
    tasks: 1,
    habits: 1,
    habitLogs: 1,
    journals: 1,
    opLogs: 1
  });
});

test('mergeRecords inserts missing ids and updates older local records', () => {
  const result = mergeRecords(
    [{ id: 'a', title: 'old', updatedAt: '2026-07-01T00:00:00.000Z' }],
    [
      { id: 'a', title: 'new', updatedAt: '2026-07-02T00:00:00.000Z' },
      { id: 'b', title: 'inserted', updatedAt: '2026-07-02T00:00:00.000Z' }
    ]
  );

  assert.deepEqual(result.records.map((item) => item.title), ['new', 'inserted']);
  assert.deepEqual(result.stats, { inserted: 1, updated: 1, skipped: 0 });
});

test('mergeRecords keeps newer local records and skips missing ids', () => {
  const result = mergeRecords(
    [{ id: 'a', title: 'local', updatedAt: '2026-07-03T00:00:00.000Z' }],
    [
      { id: 'a', title: 'incoming', updatedAt: '2026-07-02T00:00:00.000Z' },
      { title: 'no id', updatedAt: '2026-07-04T00:00:00.000Z' }
    ]
  );

  assert.equal(result.records[0].title, 'local');
  assert.deepEqual(result.stats, { inserted: 0, updated: 0, skipped: 2 });
});

test('buildImportResult merges every supported store and returns aggregate stats', () => {
  const result = buildImportResult(
    {
      tasks: [{ id: 'task_1', title: 'local', updatedAt: '2026-07-01T00:00:00.000Z' }],
      habits: [],
      habitLogs: [],
      journals: [],
      opLogs: []
    },
    {
      app: 'today-youxu',
      version: 1,
      tasks: [{ id: 'task_1', title: 'incoming', updatedAt: '2026-07-02T00:00:00.000Z' }],
      habits: [{ id: 'habit_1', updatedAt: '2026-07-02T00:00:00.000Z' }],
      habitLogs: [],
      journals: [],
      opLogs: []
    }
  );

  assert.equal(result.valid, true);
  assert.equal(result.data.tasks[0].title, 'incoming');
  assert.equal(result.data.habits.length, 1);
  assert.deepEqual(result.stats.totals, { inserted: 1, updated: 1, skipped: 0 });
});
