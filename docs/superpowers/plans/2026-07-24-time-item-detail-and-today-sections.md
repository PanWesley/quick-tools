# Time Item Detail and Today Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every active task and habit row open the existing full-screen editor directly, move completion to the bottom and deletion into a top-right overflow menu, correctly render habit colors, and split Today into current pending and completed tasks without overdue items.

**Architecture:** Add pure Today grouping and tone projection to `app-state.js`, and add one soft archive operation to `db.js`. Keep the existing quick editor as the single editing implementation, but introduce an `item-detail` entry mode so direct row navigation can save/close independently without flashing the keyboard sheet. Keep DOM rendering and event routing in `app.js`, with explicit row identity attributes and a small accessible overflow menu.

**Tech Stack:** Vanilla HTML/CSS/JavaScript PWA, IndexedDB, Node.js built-in test runner, VM-based runtime tests.

## Global Constraints

- Reuse the existing full-screen detail editor; do not add a second detail page.
- Direct row entry must not show the quick sheet or summon the software keyboard.
- The detail header contains Back, title, and “…” only; the “完成” button belongs at the bottom of scrollable content.
- Task deletion remains recoverable soft deletion; habit deletion archives the whole habit and preserves `habitLogs`.
- Today includes a task only when `date <= todayKey <= endDate`, using `date` when `endDate` is absent.
- Completed Today section is hidden when empty.
- Unknown habit tones fall back to the existing lilac default.
- Do not add third-party dependencies or upgrade the IndexedDB schema version.

---

### Task 1: Pure Today Grouping and Habit Tone Projection

**Files:**
- Modify: `tools/time/js/app-state.js`
- Modify: `tools/time/js/app-state.test.js`

**Interfaces:**
- Produces: `getTodayTaskGroups(tasks, todayKey) -> { pending: Task[], completed: Task[] }`
- Extends: habit entries returned by `getCalendarEntries(data, dateKey)` with `tone: string`

- [ ] **Step 1: Write failing state tests**

Replace the old overdue-inclusive Today test and add calendar tone coverage:

```js
test('getTodayTaskGroups includes only tasks whose range covers today', () => {
  const groups = getTodayTaskGroups([
    { id: 'past', date: '2026-07-01', status: 'active' },
    { id: 'range', date: '2026-07-01', endDate: '2026-07-02', status: 'active' },
    { id: 'today', date: '2026-07-02', status: 'active' },
    { id: 'done', date: '2026-07-02', status: 'completed' },
    { id: 'future', date: '2026-07-03', status: 'active' },
    { id: 'deleted', date: '2026-07-02', status: 'deleted' }
  ], '2026-07-02');
  assert.deepEqual(groups.pending.map(task => task.id), ['range', 'today']);
  assert.deepEqual(groups.completed.map(task => task.id), ['done']);
});

test('calendar habit entries expose the saved tone', () => {
  const entries = getCalendarEntries({
    tasks: [],
    habits: [{ id: 'habit-1', title: '喝水', schedule: 'daily', status: 'active', tone: 'sky' }],
    habitLogs: [],
    journals: []
  }, '2026-07-02');
  assert.equal(entries[0].tone, 'sky');
});
```

- [ ] **Step 2: Run the state tests and verify RED**

Run: `node --test tools/time/js/app-state.test.js`

Expected: FAIL because `getTodayTaskGroups` is missing and habit entries have no `tone`.

- [ ] **Step 3: Implement the pure selector and tone projection**

Add and export:

```js
function getTodayTaskGroups(tasks, todayKey) {
  var groups = { pending: [], completed: [] };
  (tasks || [])
    .filter(function(task) { return taskOccursOn(task, todayKey); })
    .sort(function(a, b) {
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    })
    .forEach(function(task) {
      groups[task.status === 'completed' ? 'completed' : 'pending'].push(task);
    });
  return groups;
}
```

Add `tone: habit.tone || ''` to habit calendar entries and export `getTodayTaskGroups`.

- [ ] **Step 4: Run the state tests and verify GREEN**

Run: `node --test tools/time/js/app-state.test.js`

Expected: all state tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/time/js/app-state.js tools/time/js/app-state.test.js
git commit -m "feat(time): group today tasks by current status"
```

### Task 2: Habit Archive Persistence

**Files:**
- Modify: `tools/time/js/db.js`
- Modify: `tools/time/js/db-tone.test.js`

**Interfaces:**
- Produces: `DB.archiveHabit(id) -> Promise<Habit>`
- Preserves: every record in `habitLogs`

- [ ] **Step 1: Write a failing IndexedDB test**

Extend the existing fake IndexedDB integration:

```js
test('archiveHabit archives the habit without deleting its logs', async () => {
  const habit = await DB.createHabit({ title: '喝水', schedule: 'daily', tone: 'sky' });
  await DB.upsertHabitLog(habit.id, '2026-07-24', 'done');
  await DB.archiveHabit(habit.id);

  const data = await DB.getAllData();
  assert.equal(data.habits.find(item => item.id === habit.id).status, 'archived');
  assert.equal(data.habitLogs.filter(log => log.habitId === habit.id).length, 1);
  assert.ok(data.opLogs.some(log =>
    log.entityType === 'habit' &&
    log.entityId === habit.id &&
    log.action === 'archive'
  ));
});
```

- [ ] **Step 2: Run the DB test and verify RED**

Run: `node --test tools/time/js/db-tone.test.js`

Expected: FAIL with `DB.archiveHabit is not a function`.

- [ ] **Step 3: Implement `archiveHabit`**

Add:

```js
function archiveHabit(id) {
  return getOne('habits', id).then(function(habit) {
    if (!habit) return null;
    var changes = { status: 'archived' };
    var next = Object.assign({}, habit, changes, { updatedAt: nowIso() });
    return writeWithOp('habits', next, 'archive', changes);
  });
}
```

Export `archiveHabit` from the DB API. Do not touch the `habitLogs` store.

- [ ] **Step 4: Run the DB test and verify GREEN**

Run: `node --test tools/time/js/db-tone.test.js`

Expected: all DB tone/archive tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/time/js/db.js tools/time/js/db-tone.test.js
git commit -m "feat(time): archive habits without removing history"
```

### Task 3: Today Sections and Complete Habit Color Rendering

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/css/style.css`
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/js/quick-editor-contract.test.js`

**Interfaces:**
- Consumes: `State.getTodayTaskGroups`
- Produces DOM: `#today-completed-section`, `#today-completed-list`
- Produces rendering helpers: `normalizedTone(value)`, `toneRowAttributes(tone, fallbackTone)`

- [ ] **Step 1: Write failing Today/tone contract tests**

Add:

```js
test('today has separate pending and completed task sections', () => {
  assert.match(html, /id="today-task-list"/);
  assert.match(html, /id="today-completed-section"[^>]*hidden/);
  assert.match(html, /id="today-completed-list"/);
  assert.match(app, /State\.getTodayTaskGroups\(appState\.data\.tasks,\s*appState\.todayKey\)/);
});

test('habit rows and calendar entries use their saved tone', () => {
  assert.match(app, /function normalizedTone/);
  assert.match(app, /renderHabit[\s\S]*toneRowAttributes\(habit\.tone/);
  assert.match(app, /renderDateHabit[\s\S]*toneRowAttributes\(habit\.tone/);
  assert.match(app, /renderListItem[\s\S]*toneRowAttributes\(item\.data\.tone/);
  assert.match(app, /calendarEntryTone[\s\S]*entry\.tone/);
  assert.match(css, /\.task-row\.has-item-tone \.task-content/);
  assert.match(css, /\.task-row\.has-item-tone::before/);
});
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `node --test tools/time/js/quick-editor-contract.test.js`

Expected: FAIL because the completed section and generic tone helpers do not exist.

- [ ] **Step 3: Add Today completed markup**

Insert between pending tasks and habits:

```html
<section class="panel today-section" id="today-completed-section" aria-labelledby="today-completed-title" hidden>
  <div class="section-label" id="today-completed-title">已完成</div>
  <div class="stack-list" id="today-completed-list"></div>
</section>
```

Cache both new elements in `cacheElements()`.

- [ ] **Step 4: Render groups and align the header summary**

Use one selector in both functions:

```js
var groups = State.getTodayTaskGroups(appState.data.tasks, appState.todayKey);
els.todayTaskList.innerHTML = groups.pending.length
  ? groups.pending.map(renderTask).join('')
  : renderEmpty('今天没有待办。可以点击 + 记录一件事。');
els.todayCompletedSection.hidden = groups.completed.length === 0;
els.todayCompletedList.innerHTML = groups.completed.map(renderTask).join('');
```

In `todayHeaderDesc()`, derive `active` and `completed` from `groups.pending.length` and `groups.completed.length`.

- [ ] **Step 5: Add safe generic tone rendering**

Use the fixed `TONE_CSS_COLORS` table only:

```js
function normalizedTone(value) {
  var tone = String(value || '');
  return Object.prototype.hasOwnProperty.call(TONE_CSS_COLORS, tone) ? tone : '';
}

function toneRowAttributes(value, fallbackTone) {
  var tone = normalizedTone(value) || normalizedTone(fallbackTone) || 'lilac';
  var color = TONE_CSS_COLORS[tone] || TONE_CSS_COLORS.lilac;
  return {
    className: ' has-item-tone task-tone-' + tone,
    style: ' style="--item-tone:' + color + '"'
  };
}
```

Apply the returned class/style to task and habit row articles in Today, date details, and Lists. Change `calendarEntryTone(entry)` so habit entries use `normalizedTone(entry.tone) || (entry.state === 'done' ? 'mint' : 'lilac')`.

Add:

```css
.task-row.has-item-tone .task-content {
  background: color-mix(in srgb, var(--item-tone) 52%, var(--surface));
}

.task-row.has-item-tone::before {
  background: color-mix(in srgb, var(--item-tone) 82%, var(--text-muted));
}
```

Keep the existing lilac fallback for browsers or rows without a valid tone.

- [ ] **Step 6: Run state and contract tests**

Run: `node --test tools/time/js/app-state.test.js tools/time/js/quick-editor-contract.test.js`

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add tools/time/index.html tools/time/css/style.css tools/time/js/app.js tools/time/js/quick-editor-contract.test.js
git commit -m "feat(time): split today tasks and render habit colors"
```

### Task 4: Direct Full-Screen Detail Entry and Bottom Completion

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/css/style.css`
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/js/quick-editor-runtime.test.js`
- Modify: `tools/time/js/quick-editor-contract.test.js`

**Interfaces:**
- Produces: `openItemDetail(type, id, sourceRow)`
- Adds state: `appState.quickEntryMode` with values `quick` or `item-detail`
- Reuses: `openEditTask`, `openEditHabit`, `handleQuickSubmit`

- [ ] **Step 1: Write failing direct-entry runtime tests**

Extend the runtime harness with form submission and direct entry hooks, then add:

```js
test('direct task detail skips the keyboard sheet and focuses the full panel', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{ id: 'task-1', title: '任务', date: '2026-07-12', status: 'active' }],
    habits: [], habitLogs: [], journals: [], opLogs: []
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
    tasks: [{ id: 'task-1', title: '任务', date: '2026-07-12', status: 'active' }],
    habits: [], habitLogs: [], journals: [], opLogs: []
  });
  runtime.hooks.openItemDetail('task', 'task-1');
  runtime.hooks.handleQuickFullBack();
  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
  assert.equal(runtime.elements.get('quick-sheet').hidden, true);
  assert.equal(runtime.background.inert, false);
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `node --test tools/time/js/quick-editor-runtime.test.js`

Expected: FAIL because `openItemDetail` and `quickEntryMode` do not exist.

- [ ] **Step 3: Refactor entity hydration from UI opening**

Extract `populateTaskEditor(task)` and `populateHabitEditor(habit)` from the current open functions. Keep `openEditTask(id)` and `openEditHabit(id)` behavior unchanged by calling populate then `openLockedQuickEditSession()`.

Add:

```js
function openItemDetail(type, id, sourceRow) {
  var item = type === 'habit'
    ? appState.data.habits.find(function(habit) { return habit.id === id; })
    : appState.data.tasks.find(function(task) { return task.id === id; });
  if (!item) {
    showToast(type === 'habit' ? '没有找到这个习惯' : '没有找到这条任务');
    return;
  }
  appState.quickEntryMode = 'item-detail';
  appState.quickReturnFocus = sourceRow || null;
  if (type === 'habit') populateHabitEditor(item);
  else populateTaskEditor(item);
  appState.quickEditor = QuickEditor.transition(
    QuickEditor.createSessionState(type === 'habit' ? 'edit-habit' : 'edit-task'),
    { type: 'OPEN' }
  );
  els.sheetBackdrop.hidden = false;
  lockQuickEditorScroll();
  setQuickEditorBackgroundInert(true);
  openQuickFullPanel();
}
```

Reset entry mode to `quick` in normal create/edit openers and on close.

- [ ] **Step 4: Move completion to the scroll body**

Replace the header save button with:

```html
<button type="button" class="quick-full-more" id="quick-full-more"
  aria-label="更多操作" aria-expanded="false" aria-controls="quick-full-menu">•••</button>
```

Append to `renderQuickFullPanel()`:

```js
html += '<div class="quick-full-bottom-actions">';
html += '<button type="button" class="quick-full-complete" data-action="quick-full-complete">完成</button>';
html += '</div>';
```

For `item-detail`, the bottom button dispatches the quick form submission after syncing full-detail inputs. For `quick`, it uses the existing `handleQuickFullSave()` behavior and returns to the keyboard sheet.

- [ ] **Step 5: Route row click and keyboard activation**

Give active row articles `data-item-type`, `data-item-id`, `tabindex="0"`, `role="button"`, and an accessible label. In delegated click/keydown handlers, ignore `[data-action]`, buttons, links, inputs and active swipe rows; otherwise call `openItemDetail`.

- [ ] **Step 6: Add bottom action styling**

```css
.quick-full-bottom-actions {
  padding: 8px 16px calc(20px + env(safe-area-inset-bottom));
}

.quick-full-complete {
  width: 100%;
  min-height: 52px;
  border-radius: 14px;
  background: var(--primary-gradient);
  color: #fff;
  font-weight: var(--weight-semibold);
}
```

Ensure `.quick-full-body` remains the scroll owner and no sticky/fixed rule is applied to the bottom action.

- [ ] **Step 7: Run runtime and contract tests**

Run: `node --test tools/time/js/quick-editor-runtime.test.js tools/time/js/quick-editor-contract.test.js`

Expected: all direct-entry, existing quick-entry and contract tests pass.

- [ ] **Step 8: Commit**

```bash
git add tools/time/index.html tools/time/css/style.css tools/time/js/app.js tools/time/js/quick-editor-runtime.test.js tools/time/js/quick-editor-contract.test.js
git commit -m "feat(time): open item rows in full detail"
```

### Task 5: Overflow Deletion and Final Asset Verification

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/css/style.css`
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/js/quick-editor-runtime.test.js`
- Modify: `tools/time/js/quick-editor-contract.test.js`
- Modify: `tools/time/CHANGELOG.md`
- Modify: `tools/time/sw.js`

**Interfaces:**
- Consumes: `DB.deleteTask(id)`, `DB.archiveHabit(id)`
- Produces: `openQuickFullMenu`, `closeQuickFullMenu`, `deleteEditingItem`

- [ ] **Step 1: Write failing deletion/runtime tests**

Add runtime spies for `deleteTask` and `archiveHabit`, then add:

```js
test('direct detail deletes a task with soft delete and closes on success', async () => {
  const runtime = createRuntime();
  runtime.hooks.setData({
    tasks: [{ id: 'task-1', title: '任务', date: '2026-07-12', status: 'active' }],
    habits: [], habitLogs: [], journals: [], opLogs: []
  });
  runtime.hooks.openItemDetail('task', 'task-1');
  await runtime.hooks.deleteEditingItem();
  assert.deepEqual(runtime.deletions, [{ type: 'task', id: 'task-1' }]);
  assert.equal(runtime.elements.get('quick-full-panel').hidden, true);
});

test('direct detail archives a habit and preserves the open panel on failure', async () => {
  const runtime = createRuntime({ archiveRejects: true });
  runtime.hooks.setData({
    tasks: [],
    habits: [{ id: 'habit-1', title: '习惯', schedule: 'daily', status: 'active' }],
    habitLogs: [], journals: [], opLogs: []
  });
  runtime.hooks.openItemDetail('habit', 'habit-1');
  await runtime.hooks.deleteEditingItem();
  assert.equal(runtime.elements.get('quick-full-panel').hidden, false);
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `node --test tools/time/js/quick-editor-runtime.test.js`

Expected: FAIL because the overflow menu and `deleteEditingItem` do not exist.

- [ ] **Step 3: Add the overflow menu**

Add beside the header:

```html
<div class="quick-full-menu" id="quick-full-menu" role="menu" hidden>
  <button type="button" role="menuitem" class="quick-full-delete" data-action="quick-full-delete">删除</button>
</div>
```

Implement open/close, outside-click and Escape behavior, maintaining `aria-expanded`. Bind the top-right button to toggle it.

- [ ] **Step 4: Implement confirmed task/habit deletion**

```js
function deleteEditingItem() {
  var type = appState.editingType;
  var id = appState.editingTaskId;
  var message = type === 'habit'
    ? '将删除整个习惯，但会保留历史打卡记录。确定删除吗？'
    : '删除后可在“已删除”清单恢复。确定删除吗？';
  if (!id || !window.confirm(message)) return Promise.resolve(false);
  var action = type === 'habit' ? DB.archiveHabit(id) : DB.deleteTask(id);
  return action.then(function() {
    closeQuickSession({ keepDraft: false, restoreFocus: true });
    showToast(type === 'habit' ? '习惯已删除' : '任务已删除');
    return loadData().then(function() { return true; });
  }).catch(function(error) {
    showToast('删除失败：' + error.message);
    return false;
  });
}
```

Close the menu after cancel or completion. Keep the panel open on persistence failure.

- [ ] **Step 5: Style the accessible overflow menu**

```css
.quick-full-menu {
  position: absolute;
  top: 54px;
  right: 12px;
  z-index: 2;
  min-width: 132px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.quick-full-delete {
  width: 100%;
  min-height: 44px;
  color: var(--danger);
  text-align: left;
}
```

- [ ] **Step 6: Update versions and changelog**

Add `v0.11.0 (2026-07-24)` describing the new detail entry, deletion menu, Today grouping, and habit tone fix. Set:

```js
var APP_VERSION = 'v0.11.0';
```

Increment cache identifiers consistently:

- Service Worker cache: `today-youxu-v59`
- CSS: `style.css?v=163`
- app state: `app-state.js?v=137`
- DB: `db.js?v=137`
- app: `app.js?v=166`

Update both `index.html` and `sw.js`.

- [ ] **Step 7: Run focused and full verification**

Run:

```bash
node --test tools/time/js/app-state.test.js tools/time/js/db-tone.test.js tools/time/js/quick-editor-runtime.test.js tools/time/js/quick-editor-contract.test.js
node --test tools/time/js/*.test.js
node --check tools/time/js/app-state.js
node --check tools/time/js/db.js
node --check tools/time/js/app.js
node --check tools/time/sw.js
git diff --check
```

Expected: every test passes, syntax checks produce no output, and `git diff --check` produces no output.

- [ ] **Step 8: Browser verification at 390×844**

Serve the repository and verify:

1. Yesterday-only active tasks do not render on Today.
2. Pending and Completed have separate sections; empty Completed is hidden.
3. Task and habit row clicks open detail directly without a keyboard flash.
4. The bottom Complete button appears only after scrolling the detail body.
5. The top-right overflow menu confirms task deletion and habit archival.
6. Habit tones match in Today, date detail, Lists and calendar strips.
7. Checkbox, swipe, Back, Escape and background scroll lock still work.

- [ ] **Step 9: Commit**

```bash
git add tools/time/index.html tools/time/css/style.css tools/time/js/app.js tools/time/js/quick-editor-runtime.test.js tools/time/js/quick-editor-contract.test.js tools/time/CHANGELOG.md tools/time/sw.js
git commit -m "feat(time): add detail deletion and finish item flow"
```
