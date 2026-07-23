const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getTodayTasks,
  getInboxTasks,
  getUpcomingTasks,
  getDeletedTasks,
  getTaskDisplayTitle,
  filterTasksByArea,
  normalizeArea,
  getCalendarEntries,
  getCalendarMarks,
  taskOccursOn,
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

test('getTaskDisplayTitle falls back when imported task title is missing', () => {
  assert.equal(getTaskDisplayTitle({ title: null }), '未命名任务');
  assert.equal(getTaskDisplayTitle({ title: '  ' }), '未命名任务');
  assert.equal(getTaskDisplayTitle({ title: '整理行程' }), '整理行程');
});

test('normalizeArea defaults unknown values to life', () => {
  assert.equal(normalizeArea('study'), 'study');
  assert.equal(normalizeArea(''), 'life');
  assert.equal(normalizeArea('unknown'), 'life');
});

test('filterTasksByArea narrows tasks by normalized area', () => {
  const tasks = [
    { id: 'a', area: 'life' },
    { id: 'b', area: 'study' },
    { id: 'c', area: '' }
  ];
  assert.deepEqual(filterTasksByArea(tasks, 'all').map((task) => task.id), ['a', 'b', 'c']);
  assert.deepEqual(filterTasksByArea(tasks, 'life').map((task) => task.id), ['a', 'c']);
  assert.deepEqual(filterTasksByArea(tasks, 'study').map((task) => task.id), ['b']);
});

test('habitDueOn supports daily weekdays and weekly schedules', () => {
  assert.equal(habitDueOn({ schedule: 'daily' }, '2026-07-04'), true);
  assert.equal(habitDueOn({ schedule: 'daily', startDate: '2026-07-05' }, '2026-07-04'), false);
  assert.equal(habitDueOn({ schedule: 'daily', startDate: '2026-07-05' }, '2026-07-05'), true);
  assert.equal(habitDueOn({ schedule: 'weekdays' }, '2026-07-04'), false);
  assert.equal(habitDueOn({ schedule: 'weekdays' }, '2026-07-03'), true);
  assert.equal(habitDueOn({ schedule: 'weekends' }, '2026-07-04'), true);
  assert.equal(habitDueOn({ schedule: 'weekends' }, '2026-07-03'), false);
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

test('taskOccursOn includes every date in a task range', () => {
  const task = { date: '2026-07-22', endDate: '2026-07-24', status: 'active' };
  assert.equal(taskOccursOn(task, '2026-07-21'), false);
  assert.equal(taskOccursOn(task, '2026-07-22'), true);
  assert.equal(taskOccursOn(task, '2026-07-23'), true);
  assert.equal(taskOccursOn(task, '2026-07-24'), true);
  assert.equal(taskOccursOn(task, '2026-07-25'), false);
});

test('calendar entries expose range position', () => {
  const data = { tasks: [{ id: 'task_1', title: '出差', date: '2026-07-22', endDate: '2026-07-24', status: 'active' }], habits: [], habitLogs: [], journals: [] };
  assert.equal(getCalendarEntries(data, '2026-07-22')[0].rangePosition, 'start');
  assert.equal(getCalendarEntries(data, '2026-07-23')[0].rangePosition, 'middle');
  assert.equal(getCalendarEntries(data, '2026-07-24')[0].rangePosition, 'end');
});

test('getCalendarEntries returns compact task habit and journal entries', () => {
  const entries = getCalendarEntries({
    tasks: [
      { id: 'task_1', title: null, date: '2026-07-02', status: 'active' },
      { id: 'task_2', title: '已完成', date: '2026-07-02', status: 'completed' },
      { id: 'task_3', title: '已删除', date: '2026-07-02', status: 'deleted' }
    ],
    habits: [{ id: 'habit_1', title: '喝水', schedule: 'daily', status: 'active' }],
    habitLogs: [{ id: 'log_1', habitId: 'habit_1', date: '2026-07-02', state: 'done' }],
    journals: [{ id: 'journal_1', date: '2026-07-02', content: '今天状态不错' }]
  }, '2026-07-02');

  assert.deepEqual(entries.map((entry) => [entry.type, entry.label, entry.state]), [
    ['task', '未命名任务', 'active'],
    ['task', '已完成', 'completed'],
    ['habit', '喝水', 'done'],
    ['journal', '每日一句', 'noted']
  ]);
});
