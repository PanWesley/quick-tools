# 今日有序快速编辑器交互重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新增事项改造成具备滚动锁、草稿恢复、开始/结束范围、父子面板返回和真正全屏详情的单一编辑会话。

**Architecture:** 新建 `quick-editor-state.js` 承担纯状态转换、草稿归一化和时间范围校验；`app.js` 只把状态渲染到现有底部编辑器并执行焦点、滚动锁等副作用。任务仍以 `date` 作为开始日期，新增可选 `endDate`，旧数据保持兼容。

**Tech Stack:** 原生 HTML/CSS/JavaScript、IndexedDB、localStorage、Node.js `node:test`、现有自定义滚轮选择器、移动端 PWA。

## Global Constraints

- 不新增第三方运行时依赖，不更换现有 PWA、数据库或通知架构。
- 保留晨橙、暖白、圆角和现有图标体系；不重做主导航、任务列表或其他工具页面。
- 自动聚焦必须保持在用户点击事件同步链路中；编辑器根节点不能用从屏幕外开始的 transform 动画。
- 新建草稿持久化键固定为 `today-youxu-quick-draft-v1`，编辑已有任务或习惯不能覆盖它。
- `date` 继续表示开始日期；`endDate` 为空时等价于开始日期。
- 标题为空时禁止保存；保存失败时编辑会话和草稿必须保留。
- 编辑器打开期间背景不可滚动，全局任务左右滑动处理器必须暂停。
- 所有触控目标至少 44×44px，并支持 `prefers-reduced-motion`。

---

## File Structure

- Create `tools/time/js/quick-editor-state.js`: 快速编辑会话状态、草稿归一化、日期/时间范围和持久化解析纯函数。
- Create `tools/time/js/quick-editor-state.test.js`: 上述纯函数的单元测试。
- Create `tools/time/js/quick-editor-contract.test.js`: HTML、CSS、脚本顺序、弹层层级和资源缓存的静态契约测试。
- Modify `tools/time/js/app-state.js`: 任务日期范围选择器和日历覆盖规则。
- Modify `tools/time/js/app-state.test.js`: 日期范围选择器回归测试。
- Modify `tools/time/js/db.js`: 任务 `endDate` 持久化。
- Modify `tools/time/index.html`: 新状态脚本、结束日期字段、摘要、拖拽区和根节点全屏详情。
- Modify `tools/time/js/app.js`: 编辑会话协调、草稿、本地副作用、面板渲染、保存和编辑回填。
- Modify `tools/time/css/style.css`: 键盘替换区、滚动锁、拖拽反馈、日期父/子面板和全屏详情。
- Modify `tools/time/js/service-worker-notification.test.js`: 同步当前 PWA cache 名与 app-shell 资源版本断言。
- Modify `tools/time/js/notification-integration.test.js`: 同步快速编辑器脚本顺序与资源版本断言。
- Modify `tools/time/sw.js`: 新脚本与资源版本缓存。
- Modify `tools/time/CHANGELOG.md`: 记录交互与数据兼容变化。

### Task 1: 快速编辑器纯状态与草稿规则

**Files:**
- Create: `tools/time/js/quick-editor-state.js`
- Create: `tools/time/js/quick-editor-state.test.js`

**Interfaces:**
- Consumes: `todayKey` 字符串和可选 localStorage JSON 文本。
- Produces: `createSessionState()`, `transition(state, event)`, `normalizeDraft(input, defaults)`, `validateDraft(draft)`, `setDraftDate(draft, phase, dateKey)`, `setPending(draft)`, `defaultEndTime(startTime)`, `parseStoredDraft(text)`。

- [ ] **Step 1: Write the failing state-transition tests**

```js
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
```

- [ ] **Step 2: Run tests to verify missing module failure**

Run: `node --test tools/time/js/quick-editor-state.test.js`

Expected: FAIL with `Cannot find module './quick-editor-state.js'`.

- [ ] **Step 3: Add failing draft and range tests**

```js
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
```

- [ ] **Step 4: Implement the UMD state module**

```js
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
```

- [ ] **Step 5: Run the state tests**

Run: `node --test tools/time/js/quick-editor-state.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit the pure state module**

```bash
git add tools/time/js/quick-editor-state.js tools/time/js/quick-editor-state.test.js
git commit -m "feat(time): add quick editor state model"
```

### Task 2: 任务日期范围数据兼容

**Files:**
- Modify: `tools/time/js/app-state.js:188-252`
- Modify: `tools/time/js/app-state.test.js:90-140`
- Modify: `tools/time/js/db.js:124-146`

**Interfaces:**
- Consumes: task `{ date, endDate? }`。
- Produces: `taskOccursOn(task, dateKey)`；日历 marks/entries 在范围内返回任务；DB 保存 `endDate`。

- [ ] **Step 1: Write failing date-range selector tests**

```js
const { taskOccursOn } = require('./app-state.js');

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
```

- [ ] **Step 2: Verify the selectors fail**

Run: `node --test tools/time/js/app-state.test.js`

Expected: FAIL because `taskOccursOn` is not exported and middle/end dates have no task entry.

- [ ] **Step 3: Implement inclusive range selectors**

```js
function taskOccursOn(task, dateKey) {
  if (!task || task.status === 'deleted' || !task.date) return false;
  var endDate = task.endDate && task.endDate >= task.date ? task.endDate : task.date;
  return dateKey >= task.date && dateKey <= endDate;
}

function taskRangePosition(task, dateKey) {
  var endDate = task.endDate && task.endDate >= task.date ? task.endDate : task.date;
  if (task.date === endDate) return 'single';
  if (dateKey === task.date) return 'start';
  if (dateKey === endDate) return 'end';
  return 'middle';
}
```

Replace both calendar task filters with `taskOccursOn(task, dateKey)`, export `taskOccursOn`, and add these fields to every task calendar entry:

```js
rangePosition: taskRangePosition(task, dateKey),
timeMode: task.timeMode || 'all-day',
startTime: task.startTime || '',
endTime: task.endTime || ''
```

- [ ] **Step 4: Persist optional endDate**

Add this property immediately after `date` in `DB.createTask`:

```js
endDate: input.endDate && input.date && input.endDate >= input.date ? input.endDate : (input.date || ''),
```

`DB.updateTask` already merges arbitrary changes, so no schema migration is required.

- [ ] **Step 5: Run selector and syntax checks**

Run: `node --test tools/time/js/app-state.test.js && node --check tools/time/js/db.js`

Expected: all tests PASS and both syntax checks exit 0.

- [ ] **Step 6: Commit date range support**

```bash
git add tools/time/js/app-state.js tools/time/js/app-state.test.js tools/time/js/db.js
git commit -m "feat(time): support task date ranges"
```

### Task 3: 稳定的编辑器 DOM 层级与静态契约

**Files:**
- Create: `tools/time/js/quick-editor-contract.test.js`
- Modify: `tools/time/index.html:317-410`
- Modify: `tools/time/css/style.css:3571-4375`
- Modify: `tools/time/sw.js:20-38`

**Interfaces:**
- Consumes: `TodayYouxuQuickEditor` 全局模块。
- Produces: `#quick-summary`, `#quick-drag-handle`, `#quick-end-date`, 根节点 `#quick-full-panel`，以及 `#quick-extra-panel` 单一替换区。

- [ ] **Step 1: Write failing markup and asset contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('quick editor exposes one replacement region and root-level detail panel', () => {
  assert.match(html, /id="quick-drag-handle"/);
  assert.match(html, /id="quick-summary"[^>]*aria-live="polite"/);
  assert.match(html, /id="quick-end-date"/);
  assert.match(html, /<\/section>\s*<div class="quick-full-panel" id="quick-full-panel"/);
  assert.equal((html.match(/id="quick-extra-panel"/g) || []).length, 1);
});

test('state module loads before app and is cached', () => {
  assert.ok(html.indexOf('/tools/time/js/quick-editor-state.js') < html.indexOf('/tools/time/js/app.js'));
  assert.match(sw, /\/tools\/time\/js\/quick-editor-state\.js\?v=1/);
});

test('editor CSS defines locked, child-panel, fullscreen and reduced-motion states', () => {
  assert.match(css, /body\.quick-editor-open/);
  assert.match(css, /\.quick-date-child-panel/);
  assert.match(css, /\.quick-full-panel\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
```

- [ ] **Step 2: Run the contract test to verify failure**

Run: `node --test tools/time/js/quick-editor-contract.test.js`

Expected: FAIL on missing drag handle, summary, end date, script and CSS contracts.

- [ ] **Step 3: Refactor the markup at exact anchors**

Immediately after the opening `#quick-sheet` tag insert:

```html
<div class="quick-drag-handle" id="quick-drag-handle" aria-hidden="true"><span></span></div>
<span class="sr-only" id="quick-editor-label">事项编辑器</span>
```

Add `aria-labelledby="quick-editor-label"` to `#quick-sheet`. Immediately after `<input id="quick-date" type="hidden">` insert:

```html
<input id="quick-end-date" type="hidden">
```

Immediately before the existing `#quick-extra-panel` insert:

```html
<div class="quick-summary" id="quick-summary" aria-live="polite"></div>
```

Move the complete existing block from `<div class="quick-full-panel" id="quick-full-panel" hidden>` through its matching closing `</div>` to immediately after the `</section>` that closes `#quick-sheet`. Change its opening tag to:

```html
<div class="quick-full-panel" id="quick-full-panel" role="dialog" aria-modal="true" aria-labelledby="quick-full-title" hidden>
```

Load the state module immediately before `app.js`:

```html
<script src="/tools/time/js/quick-editor-state.js?v=1"></script>
<script src="/tools/time/js/app.js?v=161"></script>
```

- [ ] **Step 4: Add structural CSS**

```css
body.quick-editor-open {
  position: fixed;
  inset-inline: 0;
  width: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}
.quick-drag-handle { min-height: 20px; display: grid; place-items: center; touch-action: none; }
.quick-drag-handle span { width: 36px; height: 4px; border-radius: 999px; background: var(--border); }
.quick-summary { min-height: 22px; padding: 0 16px 6px; color: var(--text-muted); font-size: 12px; }
.quick-extra-panel { max-height: min(58vh, calc(var(--quick-viewport-height, 100vh) - 170px)); overscroll-behavior: contain; }
.quick-date-child-panel { min-height: 330px; background: var(--surface); }
.quick-full-panel { position: fixed; inset: 0; z-index: 170; width: 100%; height: 100%; background: var(--bg); }
@media (prefers-reduced-motion: reduce) {
  .quick-extra-panel, .quick-full-panel, .quick-form-v2 { animation: none; transition: none; }
}
```

Remove `transform` from the resting `.quick-sheet-v2`; use transform only on the drag gesture class so full-screen descendants cannot be constrained again.

- [ ] **Step 5: Cache the new module and bump asset query versions consistently**

Add `/tools/time/js/quick-editor-state.js?v=1` to `APP_SHELL`; change CSS to `v=157`, app to `v=161`, and cache name to `today-youxu-v53` in both `index.html` and `sw.js`.

- [ ] **Step 6: Run the contract and syntax checks**

Run: `node --test tools/time/js/quick-editor-contract.test.js && node --check tools/time/js/quick-editor-state.js && node --check tools/time/sw.js`

Expected: all tests PASS and syntax checks exit 0.

- [ ] **Step 7: Commit the editor shell**

```bash
git add tools/time/index.html tools/time/css/style.css tools/time/sw.js tools/time/js/quick-editor-contract.test.js
git commit -m "refactor(time): establish quick editor shell"
```

### Task 4: 编辑会话、草稿、滚动锁和关闭手势

**Files:**
- Modify: `tools/time/js/app.js:1-55, 1451-1565, 3210-3540`
- Modify: `tools/time/js/quick-editor-contract.test.js`

**Interfaces:**
- Consumes: `TodayYouxuQuickEditor` pure API and form fields.
- Produces: `openQuickSession(mode, source)`, `closeQuickSession(options)`, `setQuickSurface(surface)`, `readQuickDraft()`, `writeQuickDraft(draft)`, `lockQuickEditorScroll()`, `unlockQuickEditorScroll()`。

- [ ] **Step 1: Extend the failing contract for session side effects**

```js
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
test('app coordinates scroll lock, draft storage and swipe suppression', () => {
  assert.match(app, /today-youxu-quick-draft-v1/);
  assert.match(app, /function lockQuickEditorScroll/);
  assert.match(app, /function unlockQuickEditorScroll/);
  assert.match(app, /if \(isQuickEditorOpen\(\)\) return;/);
  assert.match(app, /visualViewport.*quick-viewport-height/s);
});
```

- [ ] **Step 2: Run the contract test to verify failure**

Run: `node --test tools/time/js/quick-editor-contract.test.js`

Expected: FAIL on missing coordinator functions and draft key.

- [ ] **Step 3: Add session state and form/draft adapters**

At app initialization:

```js
var QuickEditor = window.TodayYouxuQuickEditor;
var QUICK_DRAFT_KEY = 'today-youxu-quick-draft-v1';
appState.quickEditor = QuickEditor.createSessionState();
appState.quickScrollY = 0;

function isQuickEditorOpen() { return appState.quickEditor.session === 'open'; }
function readQuickDraft() {
  return QuickEditor.normalizeDraft({
    title: els.quickTitle.value, notes: els.quickNotes.value,
    priority: els.quickPriority.value, area: els.quickArea.value, tone: els.quickTone.value,
    startDate: els.quickDate.value, endDate: els.quickEndDate.value,
    timeMode: els.quickTimeMode.value, startTime: els.quickStartTime.value, endTime: els.quickEndTime.value,
    repeat: els.quickRepeat.value, customRepeat: appState.customRepeat,
    reminder: els.quickReminder.value, customReminder: appState.customReminder
  }, { todayKey: appState.todayKey });
}
function persistCreateDraft() {
  if (appState.editingTaskId) return;
  localStorage.setItem(QUICK_DRAFT_KEY, JSON.stringify(readQuickDraft()));
}
function clearCreateDraft() { localStorage.removeItem(QUICK_DRAFT_KEY); }
```

Add the complete form writer:

```js
function applyQuickDraft(draft) {
  els.quickTitle.value = draft.title;
  els.quickNotes.value = draft.notes;
  els.quickPriority.value = draft.priority;
  els.quickArea.value = draft.area;
  els.quickTone.value = draft.tone;
  els.quickDate.value = draft.startDate;
  els.quickEndDate.value = draft.endDate;
  els.quickTimeMode.value = draft.timeMode;
  els.quickStartTime.value = draft.startTime;
  els.quickEndTime.value = draft.endTime;
  els.quickRepeat.value = draft.repeat;
  els.quickReminder.value = draft.reminder;
  appState.customRepeat = draft.customRepeat;
  appState.customReminder = draft.customReminder;
  autoResizeTextarea(els.quickNotes);
  updateTimeDisplay();
  updateToolStates();
  renderQuickSurface();
}
```

Add these assignments inside `cacheElements()` with the other quick-editor elements:

```js
els.quickEndDate = $('quick-end-date');
els.quickSummary = $('quick-summary');
els.quickDragHandle = $('quick-drag-handle');
```

- [ ] **Step 4: Add scroll, visual viewport and swipe guards**

```js
function lockQuickEditorScroll() {
  appState.quickScrollY = window.scrollY || 0;
  document.body.style.top = '-' + appState.quickScrollY + 'px';
  document.body.classList.add('quick-editor-open');
}
function unlockQuickEditorScroll() {
  document.body.classList.remove('quick-editor-open');
  document.body.style.top = '';
  window.scrollTo(0, appState.quickScrollY || 0);
}
function updateQuickViewportHeight() {
  var height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--quick-viewport-height', height + 'px');
}
```

Call `updateQuickViewportHeight` on open and on `visualViewport.resize`. Add `if (isQuickEditorOpen()) return;` as the first statement in `handleSwipeStart`, `handleSwipeMove` and `handleSwipeEnd`.

- [ ] **Step 5: Replace open/close with explicit session lifecycle**

```js
function openQuickSession(mode) {
  appState.quickEditor = QuickEditor.transition(QuickEditor.createSessionState(mode), { type: 'OPEN' });
  var stored = mode === 'create' ? QuickEditor.parseStoredDraft(localStorage.getItem(QUICK_DRAFT_KEY)) : null;
  applyQuickDraft(QuickEditor.normalizeDraft(stored, { todayKey: appState.todayKey }));
  els.sheetBackdrop.hidden = false;
  els.quickSheet.hidden = false;
  lockQuickEditorScroll();
  updateQuickViewportHeight();
  void els.quickSheet.offsetHeight;
  focusQuickTitle();
}
function closeQuickSession(options) {
  if (!appState.editingTaskId && (!options || options.keepDraft !== false)) persistCreateDraft();
  appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'CLOSE' });
  els.sheetBackdrop.hidden = true;
  els.quickSheet.hidden = true;
  els.quickFullPanel.hidden = true;
  unlockQuickEditorScroll();
  appState.editingTaskId = '';
  appState.editingType = '';
  if (options && options.restoreFocus && els.openAdd) els.openAdd.focus();
}
```

Keep `openSheet()` as a compatibility wrapper that resets edit identifiers and calls `openQuickSession('create')`. Backdrop click calls `closeQuickSession({ keepDraft: true, restoreFocus: true })`.

Bind `input` on title/notes and `change` on every hidden-choice adapter to this exact coordinator:

```js
function handleQuickDraftChange() {
  updateTimeDisplay();
  updateToolStates();
  if (typeof updateQuickSummary === 'function') updateQuickSummary();
  if (!appState.editingTaskId) persistCreateDraft();
}
```

On `pagehide` and when `visibilitychange` becomes hidden, call `persistCreateDraft()` only when the quick editor is open and not editing an existing entity.

- [ ] **Step 6: Implement drag-handle dismissal**

```js
var quickDrag = null;
els.quickDragHandle.addEventListener('pointerdown', function(event) {
  quickDrag = { id: event.pointerId, startY: event.clientY, deltaY: 0 };
  els.quickDragHandle.setPointerCapture(event.pointerId);
  els.quickSheet.classList.add('quick-sheet-dragging');
});
els.quickDragHandle.addEventListener('pointermove', function(event) {
  if (!quickDrag || quickDrag.id !== event.pointerId) return;
  quickDrag.deltaY = Math.max(0, event.clientY - quickDrag.startY);
  els.quickSheet.style.transform = 'translateY(' + quickDrag.deltaY + 'px)';
});
els.quickDragHandle.addEventListener('pointerup', function(event) {
  if (!quickDrag || quickDrag.id !== event.pointerId) return;
  var threshold = Math.min(120, els.quickSheet.getBoundingClientRect().height * 0.22);
  var shouldClose = quickDrag.deltaY >= threshold;
  quickDrag = null;
  els.quickSheet.classList.remove('quick-sheet-dragging');
  els.quickSheet.style.transform = '';
  if (shouldClose) closeQuickSession({ keepDraft: true, restoreFocus: true });
});
```

Because listeners are attached only to `#quick-drag-handle`, date grids, wheels and lists cannot initiate dismissal.

- [ ] **Step 7: Run contract and all pure tests**

Run: `node --test tools/time/js/quick-editor-contract.test.js tools/time/js/quick-editor-state.test.js && node --check tools/time/js/app.js`

Expected: all tests PASS and syntax check exits 0.

- [ ] **Step 8: Commit session lifecycle**

```bash
git add tools/time/js/app.js tools/time/js/quick-editor-contract.test.js
git commit -m "feat(time): manage quick editor sessions"
```

### Task 5: 日期父面板和时间、提醒、重复子面板

**Files:**
- Modify: `tools/time/js/quick-editor-state.js`
- Modify: `tools/time/js/app.js:1760-2210, 2700-3185`
- Modify: `tools/time/css/style.css:3780-4160`
- Modify: `tools/time/js/quick-editor-state.test.js`

**Interfaces:**
- Consumes: `appState.quickEditor.surface/dateChild/datePhase` and normalized draft.
- Produces: `createChildDraft(draft, type)`, `applyChildDraft(draft, childDraft)`, `renderQuickSurface()`, `renderDateSurface()`, `renderDateParent()`, `renderDateChild(type)`, `commitDateChild()`；子面板只在 `#quick-extra-panel` 中替换。

- [ ] **Step 1: Add failing temporary-value tests**

Add pure helper tests before implementing DOM behavior:

```js
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
```

- [ ] **Step 2: Run tests to confirm the missing helper failure**

Run: `node --test tools/time/js/quick-editor-state.test.js`

Expected: FAIL with `Editor.createChildDraft is not a function`.

- [ ] **Step 3: Implement temporary child helpers**

Add to `quick-editor-state.js` and export both functions:

```js
function createChildDraft(draft, type) {
  if (type === 'time') return {
    type: 'time', timeMode: draft.timeMode,
    startTime: draft.startTime || '09:00',
    endTime: draft.endTime || defaultEndTime(draft.startTime || '09:00')
  };
  if (type === 'reminder') return { type: 'reminder', reminder: draft.reminder, customReminder: draft.customReminder || null };
  return { type: 'repeat', repeat: draft.repeat, customRepeat: draft.customRepeat || null };
}

function applyChildDraft(draft, child) {
  var next = Object.assign({}, draft);
  if (child.type === 'time') {
    next.timeMode = child.timeMode; next.startTime = child.startTime; next.endTime = child.timeMode === 'range' ? child.endTime : '';
  } else if (child.type === 'reminder') {
    next.reminder = child.reminder; next.customReminder = child.customReminder || null;
  } else if (child.type === 'repeat') {
    next.repeat = child.repeat; next.customRepeat = child.customRepeat || null;
  }
  return next;
}
```

- [ ] **Step 4: Implement one surface renderer**

```js
function setQuickSurface(surface) {
  if (appState.quickEditor.surface === surface && surface !== 'detail') {
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'SHOW_KEYBOARD' });
    renderQuickSurface();
    focusQuickTitle();
    return;
  }
  if (document.activeElement === els.quickTitle || document.activeElement === els.quickNotes) document.activeElement.blur();
  appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'OPEN_TOOL', tool: surface });
  renderQuickSurface();
}

function renderQuickSurface() {
  var state = appState.quickEditor;
  document.querySelectorAll('.quick-tool-btn').forEach(function(button) {
    var open = button.dataset.tool === state.surface;
    button.classList.toggle('is-open', open);
    button.setAttribute('aria-pressed', String(open));
  });
  if (state.surface === 'keyboard') { els.quickExtraPanel.hidden = true; els.quickExtraPanel.innerHTML = ''; return; }
  if (state.surface === 'date') renderDateSurface();
  else if (state.surface === 'priority') renderPrioritySurface();
  else if (state.surface === 'area') renderAreaSurface();
  else if (state.surface === 'tone') renderToneSurface();
}

function renderDateSurface() {
  if (appState.quickEditor.dateChild === 'none') renderDateParent();
  else renderDateChild(appState.quickEditor.dateChild);
}
```

Remove `setTimeout` from detail-to-tool navigation and remove the compatibility call that passes an object into `openTimePicker`.

- [ ] **Step 5: Render the date parent with explicit start/end phase**

`renderDateParent()` must construct these exact stable controls before inserting the existing calendar grid and quick-date buttons between the tabs and settings list:

```html
<div class="quick-date-tabs" role="tablist" aria-label="日期范围">
  <button role="tab" data-date-phase="start">开始</button>
  <button role="tab" data-date-phase="end">结束</button>
</div>
<div id="quick-dt-calendar-container"></div>
<div class="quick-datetime-quick" id="quick-date-presets"></div>
<div class="quick-date-settings">
  <button type="button" data-date-child="time"><span>时间</span><strong id="quick-date-time-summary"></strong></button>
  <button type="button" data-date-child="reminder"><span>提醒</span><strong id="quick-date-reminder-summary"></strong></button>
  <button type="button" data-date-child="repeat"><span>重复</span><strong id="quick-date-repeat-summary"></strong></button>
</div>
```

Calendar selection calls `QuickEditor.setDraftDate(readQuickDraft(), state.datePhase, dateKey)`, applies the result, persists it, and re-renders the parent.

- [ ] **Step 6: Reuse wheels inside a date child panel**

Refactor `createPickerWheel()` so it accepts a container and never opens `picker-backdrop`. `renderDateChild('time')` builds temporary values:

```js
appState.quickChildDraft = {
  timeMode: draft.timeMode,
  startTime: draft.startTime || '09:00',
  endTime: draft.endTime || QuickEditor.defaultEndTime(draft.startTime || '09:00')
};
```

Render a child header with 返回/标题/确定, start/end tabs, hour/minute wheels and an all-day switch. `commitDateChild()` validates a merged draft; on success writes hidden inputs, persists draft and dispatches `CLOSE_DATE_CHILD`. Cancel/返回 discards `quickChildDraft` and dispatches the same transition.

Use the same temporary-value pattern for reminder and repeat. Repeat options must be `none`, `daily`, `weekdays`, `weekly`, `monthly`, `custom`; reminder options must retain `none`, `at-time`, `5`, `15`, `30`, `60`, `custom`.

- [ ] **Step 7: Add parent/child styles**

```css
.quick-date-tabs { display: grid; grid-template-columns: repeat(2, 1fr); border-bottom: 1px solid var(--border); }
.quick-date-tabs button { min-height: 44px; border: 0; background: transparent; color: var(--text-muted); }
.quick-date-tabs button[aria-selected="true"] { color: var(--primary); box-shadow: inset 0 -2px var(--primary); }
.quick-date-settings button { width: 100%; min-height: 52px; display: flex; align-items: center; justify-content: space-between; }
.quick-date-child-head { min-height: 52px; display: grid; grid-template-columns: 72px 1fr 72px; align-items: center; }
.quick-date-child-head button { min-height: 44px; border: 0; background: transparent; }
```

- [ ] **Step 8: Run state, contract and syntax tests**

Run: `node --test tools/time/js/quick-editor-state.test.js tools/time/js/quick-editor-contract.test.js && node --check tools/time/js/app.js`

Expected: all tests PASS; there is no `openTimePickerForV2({` call in `app.js`.

- [ ] **Step 9: Commit parent/child navigation**

```bash
git add tools/time/js/quick-editor-state.js tools/time/js/app.js tools/time/css/style.css tools/time/js/quick-editor-state.test.js
git commit -m "feat(time): add nested date and time panels"
```

### Task 6: 真正全屏详情、摘要、保存与编辑回填

**Files:**
- Modify: `tools/time/js/app.js:1650-1820, 2220-2505`
- Modify: `tools/time/css/style.css:4160-4375`
- Modify: `tools/time/js/quick-editor-contract.test.js`

**Interfaces:**
- Consumes: shared form/draft adapter and range fields.
- Produces: root-level full detail flow, `updateQuickSummary()`, validated payload with `endDate`, save-success draft clearing and edit range restoration.

- [ ] **Step 1: Add failing save and detail contracts**

```js
test('save payload and edit restoration include endDate', () => {
  assert.match(app, /endDate:\s*els\.quickEndDate\.value/);
  assert.match(app, /els\.quickEndDate\.value\s*=\s*task\.endDate\s*\|\|\s*task\.date/);
  assert.match(app, /clearCreateDraft\(\)/);
});

test('detail exits synchronously to focused keyboard surface', () => {
  assert.match(app, /CLOSE_DETAIL/);
  assert.doesNotMatch(app, /setTimeout\(function\(\)\s*\{\s*openQuickTool/s);
});
```

- [ ] **Step 2: Run contract test to verify failure**

Run: `node --test tools/time/js/quick-editor-contract.test.js`

Expected: FAIL on missing endDate payload/restoration and remaining delayed detail navigation.

- [ ] **Step 3: Render and exit the root-level full detail page**

`openQuickFullPanel()` dispatches `OPEN_DETAIL`, renders from `readQuickDraft()`, hides only the bottom sheet, and displays `quick-full-panel`. `closeQuickFullPanel({ focusTitle: true })` dispatches `CLOSE_DETAIL`, hides the root panel, shows the bottom sheet, forces layout and calls `focusQuickTitle()` synchronously from the Back/完成 click handler.

Full-detail field buttons render their selector inside `quick-full-body` rather than reopening the bottom sheet. A selector Back returns to the full-detail summary; the full-detail Back returns to the keyboard surface.

- [ ] **Step 4: Add summary and save button state**

```js
function updateQuickSummary() {
  var draft = readQuickDraft();
  var dateText = !draft.startDate ? '待定' : draft.startDate === draft.endDate
    ? formatDateLabel(draft.startDate)
    : formatDateLabel(draft.startDate) + '–' + formatDateLabel(draft.endDate);
  var timeText = draft.timeMode === 'all-day' ? '全天' : draft.timeMode === 'range'
    ? draft.startTime + '–' + draft.endTime : draft.startTime;
  els.quickSummary.textContent = [dateText, timeText, formatRepeatLabel(draft.repeat, draft.customRepeat), formatReminderLabel(draft.reminder, draft.customReminder)]
    .filter(function(value) { return value && value !== '不重复' && value !== '不提醒'; }).join(' · ');
  els.quickForm.querySelector('.quick-send-btn').disabled = !String(draft.title || '').trim();
}
```

Call this after every draft change and after editor open/edit restoration.

- [ ] **Step 5: Validate and save the complete task range**

At the start of `handleQuickSubmit`, call `QuickEditor.validateDraft(readQuickDraft())`. Show its message and keep the relevant panel open when invalid. Add to task payload:

```js
date: draft.startDate,
endDate: draft.endDate || draft.startDate,
timeMode: draft.timeMode,
startTime: draft.startTime,
endTime: draft.timeMode === 'range' ? draft.endTime : ''
```

On successful create/update: call `clearCreateDraft()` before `closeQuickSession({ keepDraft: false })`. On rejection: do not close or reset any fields.

When repeat creates a habit, use only `startDate: draft.startDate`; do not store task `endDate` on the habit.

- [ ] **Step 6: Restore editing ranges without touching the create draft**

In `openEditTask` set:

```js
els.quickDate.value = task.date || '';
els.quickEndDate.value = task.endDate || task.date || '';
```

In `openEditHabit` set both hidden date fields to `habit.startDate || appState.todayKey`, because habits remain single-anchor schedules. Neither edit path reads or writes `QUICK_DRAFT_KEY`.

After each edit path finishes applying fields, open the same locked session without reading the create draft:

```js
appState.quickEditor = QuickEditor.transition(QuickEditor.createSessionState(appState.editingType === 'habit' ? 'edit-habit' : 'edit-task'), { type: 'OPEN' });
els.sheetBackdrop.hidden = false;
els.quickSheet.hidden = false;
lockQuickEditorScroll();
updateQuickViewportHeight();
void els.quickSheet.offsetHeight;
focusQuickTitle();
```

Update calendar strip labels so range endpoints carry their time while middle dates remain uncluttered:

```js
function calendarEntryLabel(entry) {
  if (entry.type !== 'task' || entry.timeMode === 'all-day') return entry.label;
  if ((entry.rangePosition === 'single' || entry.rangePosition === 'start') && entry.startTime) return entry.startTime + ' ' + entry.label;
  if (entry.rangePosition === 'end' && entry.endTime) return entry.endTime + ' ' + entry.label;
  return entry.label;
}
```

Use `calendarEntryLabel(entry)` instead of `entry.label` when building task strips.

- [ ] **Step 7: Run targeted tests and syntax checks**

Run: `node --test tools/time/js/quick-editor-contract.test.js tools/time/js/quick-editor-state.test.js tools/time/js/app-state.test.js && node --check tools/time/js/app.js && node --check tools/time/js/db.js`

Expected: all tests PASS and syntax checks exit 0.

- [ ] **Step 8: Commit full detail and persistence wiring**

```bash
git add tools/time/js/app.js tools/time/css/style.css tools/time/js/quick-editor-contract.test.js
git commit -m "feat(time): complete quick editor workflow"
```

### Task 7: 发布记录、全量回归和手机视口验证

**Files:**
- Modify: `tools/time/js/app.js:2`
- Modify: `tools/time/index.html:25, 420-430`
- Modify: `tools/time/sw.js:8, 20-38`
- Modify: `tools/time/js/service-worker-notification.test.js:550-566`
- Modify: `tools/time/js/notification-integration.test.js:178-200`
- Modify: `tools/time/CHANGELOG.md:1`
- Verify: `docs/product-design-audits/time-2026-07-22/*.jpg`

**Interfaces:**
- Consumes: finished implementation and the five accepted audit screenshots.
- Produces: consistent PWA asset versions, changelog entry, full test evidence and post-change screenshots.

- [ ] **Step 1: Finalize release versions and changelog**

Set `APP_VERSION` to `v0.10.0`, keep CSS `v157`, app `v161`, state module `v1`, and cache name `today-youxu-v53` consistent between `index.html` and `sw.js`.

Add a v0.10.0 changelog section covering:

```markdown
## v0.10.0 (2026-07-22)

### 新增
- 新增事项改为单一编辑会话，支持开始/结束日期与时间、草稿恢复和真正全屏详情。

### 优化
- 快捷面板替换键盘区域；时间、提醒、重复完成后返回日期主面板。
- 编辑期间锁定背景滚动并暂停任务滑动操作。

### 兼容
- 任务新增可选 `endDate`；旧任务缺少该字段时按单日事项处理。
```

Update both existing release-contract tests to assert this exact asset set:

```js
[
  '/tools/time/css/style.css?v=157',
  '/tools/time/js/quick-editor-state.js?v=1',
  '/tools/time/js/notification-crypto.js?v=2',
  '/tools/time/js/notification-receipt.js?v=1',
  '/tools/time/js/notification-model.js?v=2',
  '/tools/time/js/notification-sync.js?v=5',
  '/tools/time/js/notification.js?v=7',
  '/tools/time/js/app.js?v=161'
]
```

Change the service-worker cache assertion to `today-youxu-v53`. In the script-order test, insert `quick-editor-state.js` immediately before `app.js` and assert its position is lower than the app script position.

- [ ] **Step 2: Run the complete time-tool test suite**

Run: `node --test tools/time/js/*.test.js`

Expected: all tests PASS, zero failures.

- [ ] **Step 3: Run syntax checks**

Run:

```bash
node --check tools/time/js/quick-editor-state.js
node --check tools/time/js/app-state.js
node --check tools/time/js/db.js
node --check tools/time/js/app.js
node --check tools/time/sw.js
```

Expected: every command exits 0 with no output.

- [ ] **Step 4: Verify the mobile flow at 390×844**

Start a fresh static server port, open `/tools/time/`, and capture these states:

1. 新增打开：`document.activeElement.id === 'quick-title'`，body 有 `quick-editor-open`。
2. 日期面板：开始/结束页签、月历和时间/提醒/重复行同时可见。
3. 时间子面板：只有一个 dialog；确认后 `dateChild === 'none'` 且日期父面板可见。
4. 点击其他快捷按钮：原面板被替换，`quick-sheet.hidden === false`。
5. 全屏详情：矩形 top=0、bottom=844；返回后 `quick-title` 重新聚焦。
6. 蒙层关闭后再次新增：标题和已选设置恢复。
7. 保存：草稿键清除，跨日任务在范围内每个日历日期出现。

Save accepted screenshots beside the existing audit under `docs/product-design-audits/time-2026-07-22/verification/` and visually compare them against both the original audit and the user-provided references at the same viewport.

- [ ] **Step 5: Record true-device gaps explicitly**

If iOS/Android hardware is unavailable, state that soft-keyboard appearance, native back gesture, VoiceOver/TalkBack order and PWA safe-area behavior remain manual verification items. Do not claim those as passed from desktop emulation.

- [ ] **Step 6: Commit release metadata and verification artifacts**

```bash
git add tools/time/CHANGELOG.md tools/time/index.html tools/time/js/app.js tools/time/sw.js tools/time/js/service-worker-notification.test.js tools/time/js/notification-integration.test.js docs/product-design-audits/time-2026-07-22/verification
git commit -m "chore(time): verify quick editor release"
```

## Plan Self-Review

- Spec coverage: every success criterion maps to Tasks 1–7; notification reminder scheduling remains anchored to the start date as specified.
- Completeness scan: every code-writing step names the exact insertion, replacement or exported interface.
- Type consistency: state keys are consistently `session`, `surface`, `dateChild`, `datePhase`, `mode`; range keys are consistently `startDate` in drafts, `date` in stored tasks, and optional `endDate` in both.
- Scope: one cohesive quick-editor subsystem; no unrelated navigation, notification backend or list redesign is included.
