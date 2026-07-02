const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getTodayTasks,
  getInboxTasks,
  getUpcomingTasks,
  getDeletedTasks,
  getCalendarMarks,
  habitDueOn,
  getHabitLogForDate
} = require('./app-state.js');

test('getTodayTasks returns active overdue and today tasks', () => {
  const tasks = [
    { id: 'a', title: 'overdue', date: '2026-07-01', status: 'active' },
    { id: 'b', title: 'today', date: '2026-07-02', status: 'active' },
    { id: 'c', title: 'future', date: '2026-07-03', status: 'active' },
    { id: 'd', title: 'done', date: '2026-07-02', status: 'completed' }
  ];
  assert.deepEqual(getTodayTasks(tasks, '2026-07-02').map((task) => task.id), ['a', 'b']);
});

test('list selectors split inbox and upcoming tasks', () => {
  const tasks = [
    { id: 'a', date: '', status: 'active' },
    { id: 'b', date: '2026-07-03', status: 'active' },
    { id: 'c', date: '2026-07-01', status: 'active' }
  ];
  assert.deepEqual(getInboxTasks(tasks).map((task) => task.id), ['a']);
  assert.deepEqual(getUpcomingTasks(tasks, '2026-07-02').map((task) => task.id), ['b']);
});

test('getDeletedTasks returns deleted tasks newest first', () => {
  const tasks = [
    { id: 'a', status: 'deleted', deletedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'b', status: 'active', deletedAt: '' },
    { id: 'c', status: 'deleted', deletedAt: '2026-07-03T00:00:00.000Z' }
  ];
  assert.deepEqual(getDeletedTasks(tasks).map((task) => task.id), ['c', 'a']);
});

test('habitDueOn supports daily weekdays and weekly schedules', () => {
  assert.equal(habitDueOn({ schedule: 'daily' }, '2026-07-04'), true);
  assert.equal(habitDueOn({ schedule: 'weekdays' }, '2026-07-04'), false);
  assert.equal(habitDueOn({ schedule: 'weekdays' }, '2026-07-03'), true);
  assert.equal(habitDueOn({ schedule: 'weekly', weekday: 4 }, '2026-07-02'), true);
});

test('getHabitLogForDate finds one matching log', () => {
  const logs = [{ id: 'log_1', habitId: 'habit_1', date: '2026-07-02' }];
  assert.equal(getHabitLogForDate(logs, 'habit_1', '2026-07-02').id, 'log_1');
});

test('getCalendarMarks reports task habit and journal markers', () => {
  const marks = getCalendarMarks({
    tasks: [{ id: 'task_1', date: '2026-07-02', status: 'active' }],
    habits: [{ id: 'habit_1', schedule: 'daily', status: 'active' }],
    habitLogs: [],
    journals: [{ id: 'journal_1', date: '2026-07-02', content: '不错' }]
  }, ['2026-07-02']);

  assert.deepEqual(marks['2026-07-02'], { tasks: 1, habits: 1, journal: true });
});
