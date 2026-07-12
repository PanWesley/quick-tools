const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNotificationCopy,
  buildReminderRecords
} = require('./notification-model');

function localDate(dateKey, time) {
  const parts = dateKey.split('-').map(Number);
  const clock = time.split(':').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], clock[0], clock[1], clock[2] || 0, 0);
}

function task(overrides = {}) {
  return Object.assign({
    id: 'task-source-123',
    title: '项目周会',
    date: '2026-07-11',
    area: 'work',
    status: 'active',
    startTime: '10:30',
    reminder: 'at-time',
    updatedAt: '2026-07-01T08:00:00.000Z'
  }, overrides);
}

function habit(overrides = {}) {
  return Object.assign({
    id: 'habit-source-456',
    title: '喝水',
    area: 'health',
    status: 'active',
    startTime: '09:00',
    reminder: 'at-time',
    updatedAt: '2026-07-01T08:00:00.000Z'
  }, overrides);
}

test('buildNotificationCopy returns the three approved templates exactly', () => {
  const due = localDate('2026-07-11', '10:30');
  assert.deepEqual(buildNotificationCopy('task', task(), due, due), {
    title: '项目周会', body: '10:30 · 工作'
  });
  assert.deepEqual(buildNotificationCopy('task', task(), due, localDate('2026-07-11', '10:15')), {
    title: '项目周会', body: '10:30 开始 · 还有 15 分钟'
  });
  assert.deepEqual(buildNotificationCopy('habit', habit(), localDate('2026-07-11', '09:00'), localDate('2026-07-11', '09:00')), {
    title: '喝水', body: '今日打卡 · 健康'
  });
});
test('copy supports all-day tasks, empty titles, seven areas, fallback, and custom offsets', () => {
  const due = localDate('2026-07-11', '09:00');
  assert.deepEqual(buildNotificationCopy('task', task({ title: '  ', startTime: '', area: 'study' }), due, due), {
    title: '未命名任务', body: '全天 · 学习'
  });
  assert.equal(buildNotificationCopy('habit', habit({ title: '' }), due, due).title, '未命名习惯');

  const expected = { life: '生活', study: '学习', work: '工作', health: '健康', housework: '家务', memory: '纪念', other: '其他' };
  Object.entries(expected).forEach(([area, label]) => {
    assert.equal(buildNotificationCopy('task', task({ area }), due, due).body, '09:00 · ' + label);
  });
  assert.equal(buildNotificationCopy('task', task({ area: 'invalid' }), due, due).body, '09:00 · 生活');
  assert.equal(
    buildNotificationCopy('task', task(), localDate('2026-07-11', '10:30'), localDate('2026-07-11', '10:14:31')).body,
    '10:30 开始 · 还有 15 分钟'
  );
});

test('task projection creates stable opaque ids, hashes source ids, and derives revision from updatedAt', async () => {
  const data = { tasks: [task({ notes: 'private notes' })], habits: [], habitLogs: [] };
  const now = localDate('2026-07-11', '08:00');
  const first = await buildReminderRecords(data, '2026-07-11', () => false, now);
  const second = await buildReminderRecords(data, '2026-07-11', () => false, now);

  assert.equal(first.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.doesNotMatch(first[0].id, /task-source-123/);
  assert.match(first[0].sourceIdHash, /^[a-f0-9]{64}$/);
  assert.equal(first[0].revision, Date.parse(data.tasks[0].updatedAt));
  assert.deepEqual(Object.keys(first[0].encryptedValue).sort(), ['body', 'data', 'scheduledAt', 'tag', 'title', 'v']);
  assert.deepEqual(first[0].encryptedValue.data, {
    type: 'task', id: 'task-source-123', date: '2026-07-11', url: '/tools/time/#today'
  });
  assert.equal(JSON.stringify(first[0].encryptedValue).includes('private notes'), false);

  const newer = await buildReminderRecords({ tasks: [task({ updatedAt: '2026-07-02T08:00:00.000Z' })] }, '2026-07-11', () => false, now);
  assert.ok(newer[0].revision > first[0].revision);
  const invalid = await buildReminderRecords({ tasks: [task({ updatedAt: 'invalid' })] }, '2026-07-11', () => false, now);
  assert.equal(invalid[0].revision, 0);
});

test('task projection filters status, missing fields, past notifications, and applies the inclusive 30-day horizon', async () => {
  const now = localDate('2026-07-11', '09:00');
  const tasks = [
    task({ id: 'past', startTime: '09:00' }),
    task({ id: 'inside', date: '2026-08-10', startTime: '08:59' }),
    task({ id: 'boundary', date: '2026-08-10', startTime: '09:00' }),
    task({ id: 'outside', date: '2026-08-10', startTime: '09:01' }),
    task({ id: 'completed', status: 'completed' }),
    task({ id: 'deleted', status: 'deleted' }),
    task({ id: 'archived', status: 'archived' }),
    task({ id: 'inactive', status: 'inactive' }),
    task({ id: 'no-date', date: '' }),
    task({ id: 'no-reminder', reminder: 'none' })
  ];
  const records = await buildReminderRecords({ tasks }, '2026-07-11', () => false, now);
  assert.deepEqual(records.map(record => record.encryptedValue.data.id), ['inside', 'boundary']);
});

test('habit projection follows recurrence, strict startTime, statuses, and done or skipped logs', async () => {
  const habits = [
    habit({ id: 'active', startTime: '07:45' }),
    habit({ id: 'legacy', status: undefined, startTime: '7:45' }),
    habit({ id: 'archived', status: 'archived' }),
    habit({ id: 'inactive', status: 'inactive' }),
    habit({ id: 'deleted', status: 'deleted' }),
    habit({ id: 'completed', status: 'completed' }),
    habit({ id: 'none', reminder: 'none' })
  ];
  const habitLogs = [
    { habitId: 'active', date: '2026-07-13', state: 'done' },
    { habitId: 'active', date: '2026-07-15', state: 'skipped' }
  ];
  const due = (_item, dateKey) => ['2026-07-12', '2026-07-13', '2026-07-15'].includes(dateKey);
  const records = await buildReminderRecords({ habits, habitLogs }, '2026-07-11', due, localDate('2026-07-11', '10:00'));
  const projected = records.map(record => ({
    id: record.encryptedValue.data.id,
    date: record.encryptedValue.data.date,
    hour: new Date(record.notifyAt).getHours(),
    minute: new Date(record.notifyAt).getMinutes()
  }));

  assert.deepEqual(projected, [
    { id: 'active', date: '2026-07-12', hour: 7, minute: 45 },
    { id: 'legacy', date: '2026-07-12', hour: 9, minute: 0 },
    { id: 'legacy', date: '2026-07-13', hour: 9, minute: 0 },
    { id: 'legacy', date: '2026-07-15', hour: 9, minute: 0 }
  ]);
});
