const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const QuickEditor = require('./quick-editor-state.js');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function createElement(id) {
  const attrs = new Map();
  const listeners = new Map();
  return {
    id,
    tagName: 'DIV',
    hidden: false,
    inert: false,
    value: '',
    textContent: '',
    dataset: {},
    disabled: false,
    scrollHeight: 24,
    offsetHeight: 1,
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    removeAttribute(name) { attrs.delete(name); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    appendChild() {},
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    click() {
      let stopped = false;
      const event = {
        target: this,
        currentTarget: this,
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() { stopped = true; }
      };
      for (const listener of listeners.get('click') || []) {
        listener.call(this, event);
        if (stopped) break;
      }
    },
    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
      this.focusCount = (this.focusCount || 0) + 1;
    },
    blur() {
      if (this.ownerDocument && this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = null;
      }
    },
    setSelectionRange(start, end) {
      this.selectionRange = { start, end };
      this.selectionRangeCalls = (this.selectionRangeCalls || 0) + 1;
    }
  };
}

function createRuntime() {
  const elements = new Map();
  let document;
  const get = id => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    const element = elements.get(id);
    element.ownerDocument = document;
    return element;
  };
  const background = createElement('background');
  const quickForm = get('quick-form');
  const send = createElement('quick-send');
  quickForm.querySelector = selector => selector === '.quick-send-btn' ? send : null;
  document = {
    hidden: false,
    activeElement: null,
    body: {
      children: [background, get('sheet-backdrop'), get('quick-sheet'), get('quick-full-panel'), get('picker-backdrop'), get('picker-sheet'), get('calendar-picker-sheet'), get('toast')],
      style: {},
      classList: { add() {}, remove() {} }
    },
    documentElement: { style: { setProperty() {} }, setAttribute() {}, getAttribute() { return ''; } },
    getElementById: get,
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    createElement: id => createElement(id)
  };
  get('picker-sheet').hidden = true;
  get('calendar-picker-sheet').hidden = true;
  const quickFullBody = get('quick-full-body');
  const quickFullNodes = new Map();
  let quickFullHtml = '';
  Object.defineProperty(quickFullBody, 'innerHTML', {
    get() { return quickFullHtml; },
    set(value) {
      quickFullHtml = String(value);
      quickFullNodes.clear();
    }
  });
  quickFullBody.querySelector = selector => {
    if (![
      '.quick-date-child-content',
      '.quick-date-child-error',
      '[data-child-back]',
      '[data-child-confirm]'
    ].includes(selector)) return null;
    if (!quickFullNodes.has(selector)) quickFullNodes.set(selector, createElement(selector));
    const element = quickFullNodes.get(selector);
    element.ownerDocument = document;
    if (selector === '.quick-date-child-content') {
      element.querySelector = childSelector => {
        const key = selector + ' ' + childSelector;
        if (childSelector !== '.quick-date-child-wheels') return null;
        if (!quickFullNodes.has(key)) quickFullNodes.set(key, createElement(key));
        const childElement = quickFullNodes.get(key);
        childElement.ownerDocument = document;
        return childElement;
      };
    }
    return element;
  };
  const updates = [];
  const db = {
    getAllData: async () => ({ tasks: [], habits: [], habitLogs: [], journals: [], opLogs: [] }),
    updateTask(id, payload) { updates.push({ id, payload }); return Promise.resolve(); },
    updateHabit(id, payload) { updates.push({ id, payload }); return Promise.resolve(); }
  };
  const window = {
    TodayYouxuDateUtils: {
      getTodayKey: () => '2026-07-12',
      fromDateKey: () => new Date('2026-07-12T00:00:00'),
      toDateKey: date => date.toISOString().slice(0, 10),
      addDays: (date, days) => new Date(date.getTime() + days * 86400000)
    },
    TodayYouxuState: { habitDueOn: () => false, normalizeArea: value => value || 'life' },
    TodayYouxuExport: {},
    TodayYouxuDB: db,
    TodayYouxuNotification: null,
    TodayYouxuNotificationModel: null,
    TodayYouxuNotificationSync: null,
    TodayYouxuQuickEditor: QuickEditor,
    navigator: {},
    location: { hash: '' },
    scrollY: 0,
    innerHeight: 844,
    scrollTo() {},
    addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    confirm: () => true,
    open() {}
  };
  window.window = window;
  const storage = new Map();
  const storageWrites = [];
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) {
      storage.set(key, String(value));
      storageWrites.push({ key, value: String(value) });
    },
    removeItem(key) { storage.delete(key); }
  };
  const instrumented = source
    .replace('      render();\n      updateNotificationUI();', '      updateNotificationUI();')
    .replace("document.addEventListener('DOMContentLoaded', init);", `window.__quickRuntimeHooks = {
      cacheElements: cacheElements,
      openEditTask: openEditTask,
      openEditHabit: openEditHabit,
      openItemDetail: openItemDetail,
      closeQuickSession: closeQuickSession,
      handleQuickSubmit: handleQuickSubmit,
      handleSwipeStart: handleSwipeStart,
      handleSwipeMove: handleSwipeMove,
      handleSwipeEnd: handleSwipeEnd,
      openQuickFullPanel: openQuickFullPanel,
      openQuickFullTool: openQuickFullTool,
      openQuickDateChild: function(type) {
        appState.quickChildDraft = QuickEditor.createChildDraft(readQuickDateDraft(), type);
        appState.quickEditor = QuickEditor.transition(appState.quickEditor, {
          type: 'OPEN_DATE_CHILD',
          child: type
        });
        renderDateSurface();
      },
      renderDateChild: renderDateChild,
      handleQuickFullBack: handleQuickFullBack,
      handleQuickFullSave: handleQuickFullSave,
      handleQuickFullComplete: handleQuickFullComplete,
      beginQuickDateSession: beginQuickDateSession,
      cancelQuickDateSession: cancelQuickDateSession,
      confirmQuickDateSession: confirmQuickDateSession,
      writeQuickDateDraft: writeQuickDateDraft,
      trapQuickEditorFocus: trapQuickEditorFocus,
      readQuickDraft: readQuickDraft,
      openCreate: function() {
        openQuickSession('create', {
          startDate: appState.todayKey,
          endDate: appState.todayKey
        });
      },
      setQuickSurface: function(surface) {
        appState.quickEditor = QuickEditor.transition(appState.quickEditor, {
          type: surface === 'keyboard' ? 'SHOW_KEYBOARD' : 'OPEN_TOOL',
          tool: surface
        });
      },
      setData: function(data) { appState.data = data; },
      getState: function() { return appState; }
    };`);
  vm.runInNewContext(instrumented, {
    window, document, navigator: window.navigator, localStorage,
    console: { warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Promise, Object, Array, String, Number, Boolean, Math, JSON, RegExp, encodeURIComponent, URL, Blob: globalThis.Blob, FileReader: class {}
  }, { filename: 'app.js' });
  window.__quickRuntimeHooks.cacheElements();
  return { hooks: window.__quickRuntimeHooks, background, document, elements, storageWrites, updates };
}

test('task and habit editing lock and restore background interaction', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{ id: 'task-1', title: '任务', date: '2026-07-12', priority: 'medium', area: 'life' }],
    habits: [{ id: 'habit-1', title: '习惯', startDate: '2026-07-12', schedule: 'daily', priority: 'medium', area: 'life', tone: 'sky' }]
  });

  runtime.hooks.openEditTask('task-1');
  assert.equal(runtime.background.inert, true);
  runtime.hooks.closeQuickSession({ keepDraft: false });
  assert.equal(runtime.background.inert, false);

  runtime.hooks.openEditHabit('habit-1');
  assert.equal(runtime.background.inert, true);
  runtime.hooks.closeQuickSession({ keepDraft: false });
  assert.equal(runtime.background.inert, false);
});

test('direct task detail skips the keyboard sheet and focuses the full panel', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{ id: 'task-1', title: '任务', date: '2026-07-12', status: 'active', priority: 'medium', area: 'life' }],
    habits: [],
    habitLogs: [],
    journals: [],
    opLogs: []
  });

  runtime.hooks.openItemDetail('task', 'task-1');

  assert.equal(runtime.elements.get('quick-sheet').hidden, true);
  assert.equal(runtime.elements.get('quick-full-panel').hidden, false);
  assert.notEqual(runtime.document.activeElement, runtime.elements.get('quick-title'));
  assert.equal(runtime.hooks.getState().quickEntryMode, 'item-detail');
});

test('direct detail back closes the whole editor without reopening the keyboard', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{ id: 'task-1', title: '任务', date: '2026-07-12', status: 'active', priority: 'medium', area: 'life' }],
    habits: [],
    habitLogs: [],
    journals: [],
    opLogs: []
  });

  runtime.hooks.openItemDetail('task', 'task-1');
  runtime.hooks.handleQuickFullBack();

  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, true);
  assert.equal(runtime.background.inert, false);
});

test('direct detail completion saves and closes the whole editor', async () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{ id: 'task-1', title: '任务', date: '2026-07-12', status: 'active', priority: 'medium', area: 'life' }],
    habits: [],
    habitLogs: [],
    journals: [],
    opLogs: []
  });

  runtime.hooks.openItemDetail('task', 'task-1');
  await runtime.hooks.handleQuickFullComplete();

  assert.equal(runtime.updates.length, 1);
  assert.equal(runtime.updates[0].id, 'task-1');
  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.background.inert, false);
});

test('direct detail date cancel returns to the detail summary without opening the keyboard', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{ id: 'task-1', title: '任务', date: '2026-07-12', status: 'active', priority: 'medium', area: 'life' }],
    habits: [],
    habitLogs: [],
    journals: [],
    opLogs: []
  });

  runtime.hooks.openItemDetail('task', 'task-1');
  runtime.hooks.openQuickFullTool('date');
  runtime.hooks.cancelQuickDateSession();

  assert.equal(runtime.hooks.getState().quickEditor.surface, 'detail');
  assert.equal(runtime.elements.get('quick-full-panel').hidden, false);
  assert.equal(runtime.elements.get('quick-sheet').hidden, true);
});

test('closing a task from the date parent tears down its date transaction before editing another habit', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{
      id: 'task-old', title: '旧任务', date: '2026-07-12', endDate: '2026-07-13',
      priority: 'medium', area: 'life', timeMode: 'range', startTime: '08:00', endTime: '09:00'
    }],
    habits: [{
      id: 'habit-new', title: '新习惯', startDate: '2026-07-20', schedule: 'daily',
      priority: 'medium', area: 'life', tone: 'sky', timeMode: 'point', startTime: '18:30'
    }]
  });

  runtime.hooks.openEditTask('task-old');
  runtime.hooks.setQuickSurface('date');
  runtime.hooks.writeQuickDateDraft(Object.assign({}, runtime.hooks.readQuickDraft(), {
    startDate: '2026-07-30',
    endDate: '2026-07-31',
    timeMode: 'range',
    startTime: '22:00',
    endTime: '23:00'
  }));
  runtime.hooks.closeQuickSession({ keepDraft: false });

  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');

  runtime.hooks.openEditHabit('habit-new');
  const nextDraft = runtime.hooks.readQuickDraft();
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.deepEqual(
    [nextDraft.startDate, nextDraft.endDate, nextDraft.timeMode, nextDraft.startTime, nextDraft.endTime],
    ['2026-07-20', '2026-07-20', 'point', '18:30', '']
  );
});

test('closing a habit from a full-detail date child tears down its date transaction before editing another task', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{
      id: 'task-new', title: '新任务', date: '2026-07-22', endDate: '2026-07-24',
      priority: 'medium', area: 'life', timeMode: 'range', startTime: '10:15', endTime: '11:45'
    }],
    habits: [{
      id: 'habit-old', title: '旧习惯', startDate: '2026-07-12', schedule: 'daily',
      priority: 'medium', area: 'life', tone: 'sky', timeMode: 'all-day'
    }]
  });

  runtime.hooks.openEditHabit('habit-old');
  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('repeat');
  runtime.hooks.writeQuickDateDraft(Object.assign({}, runtime.hooks.readQuickDraft(), {
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    repeat: 'custom',
    customRepeat: { interval: 3, unit: 'week' }
  }));
  runtime.hooks.closeQuickSession({ keepDraft: false });

  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');

  runtime.hooks.openEditTask('task-new');
  const nextDraft = runtime.hooks.readQuickDraft();
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.deepEqual(
    [nextDraft.startDate, nextDraft.endDate, nextDraft.timeMode, nextDraft.startTime, nextDraft.endTime],
    ['2026-07-22', '2026-07-24', 'range', '10:15', '11:45']
  );
});

test('editing a habit retains its tone into the update payload', async () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [{
    id: 'habit-1', title: '习惯', startDate: '2026-07-12', schedule: 'daily',
    priority: 'medium', area: 'life', tone: 'sky', reminder: 'none', timeMode: 'all-day'
  }] });

  runtime.hooks.openEditHabit('habit-1');
  assert.equal(runtime.elements.get('quick-tone').value, 'sky');
  runtime.hooks.handleQuickSubmit({ preventDefault() {} });
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  assert.equal(runtime.updates.length, 1);
  assert.equal(runtime.updates[0].payload.tone, 'sky');
});

test('keyboard quick editor prevents viewport touch scrolling without blocking replacement panels', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();

  let prevented = 0;
  runtime.hooks.handleSwipeMove({
    touches: [{ clientX: 10, clientY: 40 }],
    preventDefault() { prevented += 1; }
  });
  assert.equal(prevented, 1);

  runtime.hooks.setQuickSurface('date');
  runtime.hooks.handleSwipeMove({
    touches: [{ clientX: 10, clientY: 20 }],
    preventDefault() { prevented += 1; }
  });
  assert.equal(prevented, 1);

  runtime.hooks.closeQuickSession({ keepDraft: false });
  runtime.hooks.handleSwipeMove({
    touches: [{ clientX: 10, clientY: 10 }],
    preventDefault() { prevented += 1; }
  });
  assert.equal(prevented, 1);
});

test('open full-detail panel leaves document touch scrolling available to its internal content', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  runtime.hooks.openQuickFullPanel();

  let prevented = 0;
  runtime.hooks.handleSwipeMove({
    touches: [{ clientX: 10, clientY: 40 }],
    preventDefault() { prevented += 1; }
  });

  assert.equal(runtime.elements.get('quick-full-panel').hidden, false);
  assert.equal(prevented, 0);
});

test('closed editor left swipe opens a list row', () => {
  const runtime = createRuntime();
  const classes = new Set(['list-swipe-row']);
  const row = {
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
  const target = {
    closest(selector) {
      return selector === '.list-swipe-row' ? row : null;
    }
  };

  runtime.hooks.handleSwipeStart({
    target,
    touches: [{ clientX: 120, clientY: 40 }]
  });
  runtime.hooks.handleSwipeMove({
    touches: [{ clientX: 50, clientY: 42 }],
    preventDefault() {}
  });
  runtime.hooks.handleSwipeEnd({
    changedTouches: [{ clientX: 50, clientY: 42 }]
  });

  assert.equal(classes.has('list-open'), true);
});

test('date cancel discards temporary schedule changes and refocuses the title', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();
  const title = runtime.elements.get('quick-title');
  const focusBefore = title.focusCount;

  runtime.hooks.beginQuickDateSession();
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    timeMode: 'range',
    startTime: '09:30',
    endTime: '10:45',
    repeat: 'custom',
    customRepeat: { interval: 2, unit: 'week', skipWeekends: true },
    reminder: 'custom',
    customReminder: { days: 1, hours: 2, minutes: 3 }
  }));
  title.blur();
  runtime.hooks.cancelQuickDateSession();

  const after = runtime.hooks.readQuickDraft();
  assert.deepEqual(
    [after.startDate, after.endDate, after.timeMode, after.startTime, after.endTime, after.repeat, after.reminder],
    [before.startDate, before.endDate, before.timeMode, before.startTime, before.endTime, before.repeat, before.reminder]
  );
  assert.equal(JSON.stringify(after.customRepeat), JSON.stringify(before.customRepeat));
  assert.equal(JSON.stringify(after.customReminder), JSON.stringify(before.customReminder));
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(title.focusCount, focusBefore + 1);
  assert.equal(runtime.document.activeElement, title);
  assert.equal(runtime.storageWrites.length, 0);
});

test('date confirmation applies the full temporary schedule and refocuses the title', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();
  const title = runtime.elements.get('quick-title');
  const focusBefore = title.focusCount;

  runtime.hooks.beginQuickDateSession();
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    timeMode: 'range',
    startTime: '09:30',
    endTime: '10:45',
    repeat: 'custom',
    customRepeat: { interval: 2, unit: 'week', skipHolidays: true },
    reminder: 'custom',
    customReminder: { days: 1, hours: 2, minutes: 3 }
  }));
  title.blur();

  assert.equal(runtime.hooks.confirmQuickDateSession(), true);
  const after = runtime.hooks.readQuickDraft();
  assert.deepEqual(
    [after.startDate, after.endDate, after.timeMode, after.startTime, after.endTime, after.repeat, after.reminder],
    ['2026-07-25', '2026-07-26', 'range', '09:30', '10:45', 'custom', 'custom']
  );
  assert.equal(JSON.stringify(after.customRepeat), JSON.stringify({ interval: 2, unit: 'week', skipHolidays: true }));
  assert.equal(JSON.stringify(after.customReminder), JSON.stringify({ days: 1, hours: 2, minutes: 3 }));
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(title.focusCount, focusBefore + 1);
  assert.equal(runtime.document.activeElement, title);
  assert.equal(runtime.storageWrites.length, 1);
  assert.equal(runtime.storageWrites[0].key, 'today-youxu-quick-draft-v1');
  const persisted = JSON.parse(runtime.storageWrites[0].value);
  assert.deepEqual(
    [
      persisted.startDate,
      persisted.endDate,
      persisted.timeMode,
      persisted.startTime,
      persisted.endTime,
      persisted.repeat,
      persisted.reminder
    ],
    ['2026-07-25', '2026-07-26', 'range', '09:30', '10:45', 'custom', 'custom']
  );
  assert.equal(JSON.stringify(persisted.customRepeat), JSON.stringify({ interval: 2, unit: 'week', skipHolidays: true }));
  assert.equal(JSON.stringify(persisted.customReminder), JSON.stringify({ days: 1, hours: 2, minutes: 3 }));
});

test('escape from the date parent cancels only the date session', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();
  const title = runtime.elements.get('quick-title');
  const focusBefore = title.focusCount;
  runtime.hooks.beginQuickDateSession();
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    timeMode: 'range',
    startTime: '09:30',
    endTime: '10:45',
    repeat: 'custom',
    customRepeat: { interval: 2, unit: 'week' },
    reminder: 'custom',
    customReminder: { days: 1, hours: 2, minutes: 3 }
  }));
  title.blur();
  let prevented = 0;

  runtime.hooks.trapQuickEditorFocus({
    key: 'Escape',
    preventDefault() { prevented += 1; }
  });

  assert.equal(prevented, 1);
  assert.equal(runtime.hooks.getState().quickEditor.session, 'open');
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  const after = runtime.hooks.readQuickDraft();
  assert.deepEqual(
    [after.startDate, after.endDate, after.timeMode, after.startTime, after.endTime, after.repeat, after.reminder],
    [before.startDate, before.endDate, before.timeMode, before.startTime, before.endTime, before.repeat, before.reminder]
  );
  assert.equal(JSON.stringify(after.customRepeat), JSON.stringify(before.customRepeat));
  assert.equal(JSON.stringify(after.customReminder), JSON.stringify(before.customReminder));
  assert.equal(title.focusCount, focusBefore + 1);
  assert.equal(runtime.document.activeElement, title);
  assert.equal(runtime.storageWrites.length, 0);
});

test('full detail date cancel closes detail without persisting and focuses the visible title', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();
  const title = runtime.elements.get('quick-title');
  const focusBefore = title.focusCount;

  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('date');
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    endTime: '10:45'
  }));
  runtime.hooks.cancelQuickDateSession();

  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, false);
  assert.equal(runtime.elements.get('quick-sheet').inert, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.document.activeElement, title);
  assert.equal(title.focusCount, focusBefore + 1);
  assert.equal(runtime.storageWrites.length, 0);
  assert.deepEqual(
    [runtime.hooks.readQuickDraft().startDate, runtime.hooks.readQuickDraft().endDate],
    [before.startDate, before.endDate]
  );
});

test('full detail date confirmation closes detail, persists once, and focuses the visible title', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();
  const title = runtime.elements.get('quick-title');
  const focusBefore = title.focusCount;

  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('date');
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    timeMode: 'range',
    startTime: '09:30',
    endTime: '10:45'
  }));

  assert.equal(runtime.hooks.confirmQuickDateSession(), true);
  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, false);
  assert.equal(runtime.elements.get('quick-sheet').inert, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.document.activeElement, title);
  assert.equal(title.focusCount, focusBefore + 1);
  assert.equal(runtime.storageWrites.length, 1);
  assert.deepEqual(
    [
      runtime.hooks.readQuickDraft().startDate,
      runtime.hooks.readQuickDraft().endDate,
      runtime.hooks.readQuickDraft().startTime,
      runtime.hooks.readQuickDraft().endTime
    ],
    ['2026-07-25', '2026-07-26', '09:30', '10:45']
  );
});

test('full detail date child Escape returns to date parent before cancelling the transaction', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();

  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('repeat');
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    repeat: 'custom',
    customRepeat: { interval: 2, unit: 'week' }
  }));

  runtime.hooks.trapQuickEditorFocus({ key: 'Escape', preventDefault() {} });
  assert.equal(runtime.elements.get('quick-full-panel').hidden, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'date');
  assert.equal(runtime.hooks.getState().quickEditor.dateChild, 'none');
  assert.notEqual(runtime.hooks.getState().quickDateSession, null);

  runtime.hooks.trapQuickEditorFocus({ key: 'Escape', preventDefault() {} });
  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.storageWrites.length, 0);
  assert.equal(runtime.hooks.readQuickDraft().repeat, before.repeat);
  assert.equal(JSON.stringify(runtime.hooks.readQuickDraft().customRepeat), JSON.stringify(before.customRepeat));
});

test('ordinary full detail tool Escape returns to its summary before closing detail', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const title = runtime.elements.get('quick-title');

  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('priority');
  runtime.hooks.trapQuickEditorFocus({ key: 'Escape', preventDefault() {} });

  assert.equal(runtime.elements.get('quick-full-panel').hidden, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'detail');

  runtime.hooks.trapQuickEditorFocus({ key: 'Escape', preventDefault() {} });
  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.document.activeElement, title);
});

test('full detail back handler cancels a date child transaction and restores the title cursor', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const title = runtime.elements.get('quick-title');
  title.value = '返回后的标题';
  const before = runtime.hooks.readQuickDraft();

  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('repeat');
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    repeat: 'custom',
    customRepeat: { interval: 2, unit: 'week' }
  }));
  runtime.hooks.handleQuickFullBack();

  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, false);
  assert.equal(runtime.elements.get('quick-sheet').inert, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.document.activeElement, title);
  assert.deepEqual(title.selectionRange, {
    start: title.value.length,
    end: title.value.length
  });
  assert.equal(runtime.hooks.readQuickDraft().startDate, before.startDate);
  assert.equal(runtime.hooks.readQuickDraft().repeat, before.repeat);
  assert.equal(runtime.storageWrites.length, 0);
});

test('full detail save handler confirms the complete date transaction and restores the title cursor', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const title = runtime.elements.get('quick-title');
  title.value = '完成后的标题';
  const before = runtime.hooks.readQuickDraft();

  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('date');
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    timeMode: 'range',
    startTime: '09:30',
    endTime: '10:45',
    repeat: 'custom',
    customRepeat: { interval: 2, unit: 'week', skipWeekends: true },
    reminder: 'custom',
    customReminder: { days: 1, hours: 2, minutes: 3 }
  }));
  runtime.hooks.handleQuickFullSave();

  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, false);
  assert.equal(runtime.elements.get('quick-sheet').inert, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.document.activeElement, title);
  assert.deepEqual(title.selectionRange, {
    start: title.value.length,
    end: title.value.length
  });
  const after = runtime.hooks.readQuickDraft();
  assert.deepEqual(
    [after.startDate, after.endDate, after.timeMode, after.startTime, after.endTime, after.repeat, after.reminder],
    ['2026-07-25', '2026-07-26', 'range', '09:30', '10:45', 'custom', 'custom']
  );
  assert.equal(JSON.stringify(after.customRepeat), JSON.stringify({ interval: 2, unit: 'week', skipWeekends: true }));
  assert.equal(JSON.stringify(after.customReminder), JSON.stringify({ days: 1, hours: 2, minutes: 3 }));
  assert.equal(runtime.storageWrites.length, 1);
  const persisted = JSON.parse(runtime.storageWrites[0].value);
  assert.deepEqual(
    [
      persisted.startDate,
      persisted.endDate,
      persisted.timeMode,
      persisted.startTime,
      persisted.endTime,
      persisted.repeat,
      persisted.reminder
    ],
    ['2026-07-25', '2026-07-26', 'range', '09:30', '10:45', 'custom', 'custom']
  );
  assert.equal(JSON.stringify(persisted.customRepeat), JSON.stringify({ interval: 2, unit: 'week', skipWeekends: true }));
  assert.equal(JSON.stringify(persisted.customReminder), JSON.stringify({ days: 1, hours: 2, minutes: 3 }));
});

test('full detail top handlers retain non-date return and save behavior', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();

  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('priority');
  runtime.hooks.handleQuickFullBack();
  assert.equal(runtime.elements.get('quick-full-panel').hidden, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'detail');

  runtime.hooks.openQuickFullTool('priority');
  runtime.hooks.handleQuickFullSave();
  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
});

test('full detail save confirms the latest custom reminder child wheel values', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('date');
  runtime.hooks.openQuickDateChild('reminder');

  const child = runtime.hooks.getState().quickChildDraft;
  child.reminder = 'custom';
  child.customReminder = { days: 0, hours: 0, minutes: 5 };
  runtime.hooks.renderDateChild('reminder');
  runtime.hooks.getState().quickChildWheels.days.setIndex(1);
  runtime.hooks.getState().quickChildWheels.hours.setIndex(2);
  runtime.hooks.getState().quickChildWheels.minutes.setIndex(3);

  runtime.hooks.handleQuickFullSave();

  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.hooks.getState().quickEditor.dateChild, 'none');
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  const after = runtime.hooks.readQuickDraft();
  assert.equal(after.reminder, 'custom');
  assert.equal(JSON.stringify(after.customReminder), JSON.stringify({
    days: 1,
    hours: 2,
    minutes: 3
  }));
  assert.equal(runtime.storageWrites.length, 1);
  const persisted = JSON.parse(runtime.storageWrites[0].value);
  assert.equal(persisted.reminder, 'custom');
  assert.equal(JSON.stringify(persisted.customReminder), JSON.stringify({
    days: 1,
    hours: 2,
    minutes: 3
  }));
});

test('full detail save confirms the latest time child wheel value', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('date');
  runtime.hooks.openQuickDateChild('time');

  const child = runtime.hooks.getState().quickChildDraft;
  child.timeMode = 'range';
  child.timePhase = 'start';
  child.startTime = '09:00';
  child.endTime = '15:00';
  runtime.hooks.renderDateChild('time');
  runtime.hooks.getState().quickChildWheels.hours.setIndex(14);
  runtime.hooks.getState().quickChildWheels.minutes.setIndex(35);

  runtime.hooks.handleQuickFullSave();

  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.hooks.getState().quickEditor.dateChild, 'none');
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  const after = runtime.hooks.readQuickDraft();
  assert.deepEqual(
    [after.timeMode, after.startTime, after.endTime],
    ['range', '14:35', '15:00']
  );
  assert.equal(runtime.storageWrites.length, 1);
  const persisted = JSON.parse(runtime.storageWrites[0].value);
  assert.deepEqual(
    [persisted.timeMode, persisted.startTime, persisted.endTime],
    ['range', '14:35', '15:00']
  );
});

test('full detail save keeps an invalid reminder child open without committing', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  runtime.hooks.openQuickFullPanel();
  runtime.hooks.openQuickFullTool('date');
  runtime.hooks.openQuickDateChild('reminder');

  const child = runtime.hooks.getState().quickChildDraft;
  child.reminder = 'custom';
  child.customReminder = { days: 0, hours: 0, minutes: 5 };
  runtime.hooks.renderDateChild('reminder');
  runtime.hooks.getState().quickChildWheels.days.setIndex(0);
  runtime.hooks.getState().quickChildWheels.hours.setIndex(0);
  runtime.hooks.getState().quickChildWheels.minutes.setIndex(0);

  runtime.hooks.handleQuickFullSave();

  assert.equal(runtime.elements.get('quick-full-panel').hidden, false);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'date');
  assert.equal(runtime.hooks.getState().quickEditor.dateChild, 'reminder');
  assert.notEqual(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.storageWrites.length, 0);
  assert.equal(runtime.hooks.readQuickDraft().reminder, 'none');
  assert.equal(
    runtime.elements.get('quick-full-body').querySelector('.quick-date-child-error').textContent,
    '提醒时间不能为0'
  );
});
