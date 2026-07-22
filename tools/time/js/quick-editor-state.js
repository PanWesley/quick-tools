(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TodayYouxuQuickEditor = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  var SURFACES = ['keyboard', 'date', 'priority', 'area', 'tone', 'detail'];
  var CHILDREN = ['none', 'time', 'reminder', 'repeat'];

  function createSessionState(mode) {
    return { session: 'closed', surface: 'keyboard', dateChild: 'none', datePhase: 'start', mode: mode || 'create' };
  }

  function transition(state, event) {
    var next = Object.assign({}, state || createSessionState());
    if (event.type === 'OPEN') next.session = 'open';
    if (event.type === 'CLOSE') next.session = 'closed';
    if (event.type === 'SHOW_KEYBOARD') { next.surface = 'keyboard'; next.dateChild = 'none'; }
    if (event.type === 'OPEN_TOOL' && SURFACES.includes(event.tool)) {
      next.surface = event.tool; next.dateChild = 'none';
    }
    if (event.type === 'OPEN_DATE_CHILD' && next.surface === 'date' && CHILDREN.includes(event.child)) {
      next.dateChild = event.child;
    }
    if (event.type === 'CLOSE_DATE_CHILD') { next.surface = 'date'; next.dateChild = 'none'; }
    if (event.type === 'SET_DATE_PHASE') next.datePhase = event.phase === 'end' ? 'end' : 'start';
    if (event.type === 'OPEN_DETAIL') { next.surface = 'detail'; next.dateChild = 'none'; }
    if (event.type === 'CLOSE_DETAIL') { next.surface = 'keyboard'; next.dateChild = 'none'; }
    return next;
  }

  function isDateKey(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
  function defaultEndTime(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return '';
    var parts = value.split(':').map(Number);
    var total = Math.min(parts[0] * 60 + parts[1] + 60, 23 * 60 + 59);
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  function normalizeDraft(input, defaults) {
    input = input && typeof input === 'object' ? input : {};
    var todayKey = defaults && defaults.todayKey || '';
    var startDate = isDateKey(input.startDate || input.date) ? (input.startDate || input.date) : todayKey;
    var endDate = isDateKey(input.endDate) && input.endDate >= startDate ? input.endDate : startDate;
    var draft = {
      title: String(input.title || ''), notes: String(input.notes || ''),
      priority: input.priority || 'medium', area: input.area || 'life', tone: input.tone || '',
      startDate: startDate, endDate: endDate,
      timeMode: ['all-day', 'point', 'range'].includes(input.timeMode) ? input.timeMode : 'all-day',
      startTime: String(input.startTime || ''), endTime: String(input.endTime || ''),
      repeat: input.repeat || 'none', customRepeat: input.customRepeat || null,
      reminder: input.reminder || 'none', customReminder: input.customReminder || null
    };
    if (draft.timeMode === 'range' && draft.startTime && !draft.endTime) draft.endTime = defaultEndTime(draft.startTime);
    return draft;
  }

  function setDraftDate(draft, phase, dateKey) {
    var next = Object.assign({}, draft);
    if (phase === 'end') next.endDate = dateKey < next.startDate ? next.startDate : dateKey;
    else {
      next.startDate = dateKey;
      if (!next.endDate || next.endDate < dateKey) next.endDate = dateKey;
    }
    return next;
  }

  function setPending(draft) {
    return Object.assign({}, draft, {
      startDate: '', endDate: '', timeMode: 'all-day', startTime: '', endTime: '',
      repeat: 'none', customRepeat: null, reminder: 'none', customReminder: null
    });
  }

  function validateDraft(draft) {
    if (!String(draft.title || '').trim()) return { valid: false, field: 'title', message: '请输入标题' };
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      return { valid: false, field: 'endDate', message: '结束日期不能早于开始日期' };
    }
    if (draft.timeMode === 'range' && draft.startDate === draft.endDate && draft.startTime && draft.endTime <= draft.startTime) {
      return { valid: false, field: 'endTime', message: '结束时间需晚于开始时间' };
    }
    return { valid: true };
  }

  function parseStoredDraft(text) {
    try { var value = JSON.parse(text); return value && typeof value === 'object' ? value : null; }
    catch (error) { return null; }
  }

  return { createSessionState, transition, normalizeDraft, validateDraft, setDraftDate, setPending, defaultEndTime, parseStoredDraft };
});
