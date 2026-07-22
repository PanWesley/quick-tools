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
