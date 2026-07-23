const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const QuickEditor = require('./quick-editor-state.js');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function createElement(id) {
  const attrs = new Map();
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
    addEventListener() {},
    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
      this.focusCount = (this.focusCount || 0) + 1;
    },
    blur() {
      if (this.ownerDocument && this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = null;
      }
    },
    setSelectionRange() {}
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
  const updates = [];
  const db = {
    getAllData: async () => ({ tasks: [], habits: [], habitLogs: [], journals: [], opLogs: [] }),
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
  const instrumented = source
    .replace('      render();\n      updateNotificationUI();', '      updateNotificationUI();')
    .replace("document.addEventListener('DOMContentLoaded', init);", `window.__quickRuntimeHooks = {
      cacheElements: cacheElements,
      openEditTask: openEditTask,
      openEditHabit: openEditHabit,
      closeQuickSession: closeQuickSession,
      handleQuickSubmit: handleQuickSubmit,
      handleSwipeStart: handleSwipeStart,
      handleSwipeMove: handleSwipeMove,
      handleSwipeEnd: handleSwipeEnd,
      openQuickFullPanel: openQuickFullPanel,
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
    window, document, navigator: window.navigator, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console: { warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Promise, Object, Array, String, Number, Boolean, Math, JSON, RegExp, encodeURIComponent, URL, Blob: globalThis.Blob, FileReader: class {}
  }, { filename: 'app.js' });
  window.__quickRuntimeHooks.cacheElements();
  return { hooks: window.__quickRuntimeHooks, background, elements, updates };
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

  runtime.hooks.beginQuickDateSession();
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    repeat: 'daily',
    reminder: '15'
  }));
  runtime.hooks.cancelQuickDateSession();

  const after = runtime.hooks.readQuickDraft();
  assert.equal(after.startDate, before.startDate);
  assert.equal(after.repeat, before.repeat);
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.elements.get('quick-title').focusCount > 0, true);
});

test('date confirmation applies the full temporary schedule and refocuses the title', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();

  runtime.hooks.beginQuickDateSession();
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    timeMode: 'point',
    startTime: '09:30',
    repeat: 'daily',
    reminder: '15'
  }));

  assert.equal(runtime.hooks.confirmQuickDateSession(), true);
  const after = runtime.hooks.readQuickDraft();
  assert.deepEqual(
    [after.startDate, after.endDate, after.timeMode, after.startTime, after.repeat, after.reminder],
    ['2026-07-25', '2026-07-26', 'point', '09:30', 'daily', '15']
  );
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
});

test('escape from the date parent cancels only the date session', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  runtime.hooks.beginQuickDateSession();
  let prevented = 0;

  runtime.hooks.trapQuickEditorFocus({
    key: 'Escape',
    preventDefault() { prevented += 1; }
  });

  assert.equal(prevented, 1);
  assert.equal(runtime.hooks.getState().quickEditor.session, 'open');
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.hooks.getState().quickDateSession, null);
});
