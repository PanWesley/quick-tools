const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExportPayload } = require('./export.js');

test('buildExportPayload includes all local-first stores', () => {
  const payload = buildExportPayload({
    tasks: [{ id: 'task_1', title: '整理计划' }],
    habits: [{ id: 'habit_1', title: '阅读' }],
    habitLogs: [{ id: 'log_1', habitId: 'habit_1' }],
    journals: [{ id: 'journal_1', date: '2026-07-02' }],
    opLogs: [{ id: 'op_1', entityType: 'task' }]
  }, '2026-07-02T00:00:00.000Z');

  assert.equal(payload.app, 'today-youxu');
  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, '2026-07-02T00:00:00.000Z');
  assert.equal(payload.tasks.length, 1);
  assert.equal(payload.habits.length, 1);
  assert.equal(payload.habitLogs.length, 1);
  assert.equal(payload.journals.length, 1);
  assert.equal(payload.opLogs.length, 1);
});
