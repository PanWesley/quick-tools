const test = require('node:test');
const assert = require('node:assert/strict');
const Editor = require('./quick-editor-state.js');

test('editor surfaces replace each other without closing the session', () => {
  let state = Editor.createSessionState();
  state = Editor.transition(state, { type: 'OPEN' });
  assert.deepEqual(state, {
    session: 'open', surface: 'keyboard', dateChild: 'none', datePhase: 'start', mode: 'create'
  });
  state = Editor.transition(state, { type: 'OPEN_TOOL', tool: 'date' });
  state = Editor.transition(state, { type: 'OPEN_DATE_CHILD', child: 'time' });
  state = Editor.transition(state, { type: 'OPEN_TOOL', tool: 'priority' });
  assert.equal(state.surface, 'priority');
  assert.equal(state.dateChild, 'none');
  assert.equal(state.session, 'open');
});

test('date child confirmation returns to the date parent', () => {
  let state = Editor.transition(Editor.createSessionState(), { type: 'OPEN' });
  state = Editor.transition(state, { type: 'OPEN_TOOL', tool: 'date' });
  state = Editor.transition(state, { type: 'OPEN_DATE_CHILD', child: 'reminder' });
  state = Editor.transition(state, { type: 'CLOSE_DATE_CHILD' });
  assert.equal(state.surface, 'date');
  assert.equal(state.dateChild, 'none');
});

test('detail back returns to keyboard', () => {
  let state = Editor.transition(Editor.createSessionState(), { type: 'OPEN' });
  state = Editor.transition(state, { type: 'OPEN_DETAIL' });
  state = Editor.transition(state, { type: 'CLOSE_DETAIL' });
  assert.equal(state.surface, 'keyboard');
});

test('draft normalization preserves valid values and repairs an invalid end date', () => {
  const draft = Editor.normalizeDraft({
    title: '  开会  ', startDate: '2026-07-23', endDate: '2026-07-22',
    startTime: '09:30', endTime: '', timeMode: 'range', priority: 'high'
  }, { todayKey: '2026-07-22' });
  assert.equal(draft.title, '  开会  ');
  assert.equal(draft.startDate, '2026-07-23');
  assert.equal(draft.endDate, '2026-07-23');
  assert.equal(draft.endTime, '10:30');
});

test('draft normalization keeps an explicitly pending stored date pending', () => {
  const storedPending = Editor.normalizeDraft({
    title: '稍后再排', startDate: '', endDate: '', timeMode: 'all-day'
  }, { todayKey: '2026-07-22' });
  const freshDraft = Editor.normalizeDraft({}, { todayKey: '2026-07-22' });

  assert.deepEqual([storedPending.startDate, storedPending.endDate], ['', '']);
  assert.deepEqual([freshDraft.startDate, freshDraft.endDate], ['2026-07-22', '2026-07-22']);
});

test('pending clears schedule-dependent values', () => {
  const result = Editor.setPending(Editor.normalizeDraft({
    startDate: '2026-07-22', endDate: '2026-07-23', timeMode: 'range',
    startTime: '09:00', endTime: '10:00', repeat: 'daily', reminder: '15'
  }, { todayKey: '2026-07-22' }));
  assert.deepEqual(
    [result.startDate, result.endDate, result.timeMode, result.startTime, result.endTime, result.repeat, result.reminder],
    ['', '', 'all-day', '', '', 'none', 'none']
  );
});

test('same-day range requires the end time to be later', () => {
  assert.deepEqual(Editor.validateDraft({
    title: '开会', startDate: '2026-07-22', endDate: '2026-07-22',
    timeMode: 'range', startTime: '10:00', endTime: '09:30'
  }), { valid: false, field: 'endTime', message: '结束时间需晚于开始时间' });
});

test('stored draft parser rejects malformed JSON without throwing', () => {
  assert.equal(Editor.parseStoredDraft('{broken'), null);
});

test('time child uses temporary values without mutating the draft', () => {
  const draft = { timeMode: 'point', startTime: '09:00', endTime: '' };
  const child = Editor.createChildDraft(draft, 'time');
  assert.deepEqual(child, { type: 'time', timeMode: 'point', startTime: '09:00', endTime: '10:00' });
  assert.equal(draft.endTime, '');
});

test('confirmed child values merge only their scheduling fields', () => {
  const draft = { title: '开会', reminder: 'none', customReminder: null };
  const merged = Editor.applyChildDraft(draft, { type: 'reminder', reminder: '15', customReminder: null });
  assert.equal(merged.title, '开会');
  assert.equal(merged.reminder, '15');
});

test('choosing an end date without a start date creates a same-day range', () => {
  const result = Editor.setDraftDate({ startDate: '', endDate: '' }, 'end', '2026-07-25');
  assert.deepEqual([result.startDate, result.endDate], ['2026-07-25', '2026-07-25']);
});

test('schedule validation permits a blank title while rejecting an invalid range', () => {
  assert.deepEqual(Editor.validateSchedule({
    title: '', startDate: '2026-07-25', endDate: '2026-07-25',
    timeMode: 'range', startTime: '10:00', endTime: '09:30'
  }), { valid: false, field: 'endTime', message: '结束时间需晚于开始时间' });
  assert.deepEqual(Editor.validateSchedule({ title: '', startDate: '2026-07-25', endDate: '2026-07-25' }), { valid: true });
});

test('full draft validation still requires a title after schedule validation', () => {
  assert.deepEqual(Editor.validateDraft({ title: '', startDate: '2026-07-25', endDate: '2026-07-25' }), {
    valid: false, field: 'title', message: '请输入标题'
  });
});
