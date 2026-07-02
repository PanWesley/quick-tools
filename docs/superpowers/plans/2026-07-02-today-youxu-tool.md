# Today Youxu Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `tools/time/` static PWA for “今日有序” with local tasks, habits, journal entries, calendar marks, JSON export, and integration into the Quick Tools shell.

**Architecture:** Use the existing static-tool style: plain HTML/CSS/JavaScript, an isolated manifest and service worker, IndexedDB for user data, and small pure utility modules for testable behavior. The app is local-first; sync and Web Push are visible as future states, not active features.

**Tech Stack:** HTML, CSS, browser JavaScript, IndexedDB, Service Worker, Node built-in `node:test` for pure utility tests.

---

## File Structure

- Create `tools/time/index.html`: app shell, four views, quick-add sheet, templates loaded by JavaScript.
- Create `tools/time/css/style.css`: mobile-first UI, dark/light theme using `quick-tools-theme`, accessible controls.
- Create `tools/time/js/date-utils.js`: date formatting, date comparisons, month grid, date keys.
- Create `tools/time/js/export.js`: export payload shaping and browser download helper.
- Create `tools/time/js/db.js`: IndexedDB stores and CRUD with OpLog writes.
- Create `tools/time/js/app.js`: view state, render pipeline, form handlers, SW registration.
- Create `tools/time/js/date-utils.test.js`: Node tests for date utilities.
- Create `tools/time/js/export.test.js`: Node tests for export payload shaping.
- Create `tools/time/js/app-state.test.js`: Node tests for pure task/habit/journal selectors.
- Create `tools/time/manifest.json`: standalone PWA metadata for 今日有序.
- Create `tools/time/sw.js`: cache-first app shell service worker.
- Create `tools/time/README.md`: scope, storage, verification notes.
- Modify `index.html`: add a 今日有序 tool card and icon style.
- Modify `manifest.json`: add a 今日有序 shortcut.
- Modify `sw.js`: include `/tools/time/` in root shell cache.
- Modify `vercel.json`: add cache headers and rewrites for `/tools/time`.

## Tasks

### Task 1: Pure Utilities and Failing Tests

**Files:**
- Create: `tools/time/js/date-utils.test.js`
- Create: `tools/time/js/export.test.js`
- Create: `tools/time/js/app-state.test.js`
- Create: `tools/time/js/date-utils.js`
- Create: `tools/time/js/export.js`
- Create: `tools/time/js/app-state.js`

- [ ] **Step 1: Write failing tests**

`tools/time/js/date-utils.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toDateKey,
  addDays,
  buildMonthGrid,
  isSameOrBefore,
  isSameOrAfter
} = require('./date-utils.js');

test('toDateKey formats local dates as YYYY-MM-DD', () => {
  assert.equal(toDateKey(new Date(2026, 6, 2)), '2026-07-02');
});

test('addDays does not mutate the input date', () => {
  const base = new Date(2026, 6, 2);
  assert.equal(toDateKey(addDays(base, 3)), '2026-07-05');
  assert.equal(toDateKey(base), '2026-07-02');
});

test('buildMonthGrid returns 42 cells with leading and trailing days', () => {
  const grid = buildMonthGrid(2026, 6);
  assert.equal(grid.length, 42);
  assert.equal(grid[0].dateKey, '2026-06-29');
  assert.equal(grid[3].dateKey, '2026-07-02');
  assert.equal(grid[3].isCurrentMonth, true);
});

test('date comparison helpers compare YYYY-MM-DD keys', () => {
  assert.equal(isSameOrBefore('2026-07-01', '2026-07-02'), true);
  assert.equal(isSameOrAfter('2026-07-03', '2026-07-02'), true);
});
```

`tools/time/js/export.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExportPayload } = require('./export.js');

test('buildExportPayload includes all local-first stores', () => {
  const payload = buildExportPayload({
    tasks: [{ id: 'task_1', title: '整理计划' }],
    habits: [{ id: 'habit_1', title: '阅读' }],
    habitLogs: [{ id: 'log_1', habitId: 'habit_1' }],
    journals: [{ id: 'journal_1', date: '2026-07-02' }],
    opLogs: [{ id: 'op_1', entityType: 'task' }]
  }, '2026-07-02T00:00:00.000Z');

  assert.equal(payload.app, 'today-youxu');
  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, '2026-07-02T00:00:00.000Z');
  assert.equal(payload.tasks.length, 1);
  assert.equal(payload.habits.length, 1);
  assert.equal(payload.habitLogs.length, 1);
  assert.equal(payload.journals.length, 1);
  assert.equal(payload.opLogs.length, 1);
});
```

`tools/time/js/app-state.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getTodayTasks,
  getInboxTasks,
  getUpcomingTasks,
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
```

- [ ] **Step 2: Run tests and verify red**

Run:

```powershell
node --test tools/time/js/date-utils.test.js tools/time/js/export.test.js tools/time/js/app-state.test.js
```

Expected: fail because the required modules do not exist.

- [ ] **Step 3: Implement utilities**

Implement `date-utils.js`, `export.js`, and `app-state.js` with CommonJS exports and browser globals.

- [ ] **Step 4: Run tests and verify green**

Run:

```powershell
node --test tools/time/js/date-utils.test.js tools/time/js/export.test.js tools/time/js/app-state.test.js
```

Expected: all tests pass.

### Task 2: IndexedDB Persistence

**Files:**
- Create: `tools/time/js/db.js`

- [ ] **Step 1: Implement DB wrapper after utility tests are green**

Add `todayYouxuDB` version 1 with stores `tasks`, `habits`, `habitLogs`, `journals`, and `opLogs`. Each write method creates an OpLog row with `syncState: "local"`.

- [ ] **Step 2: Syntax-check DB**

Run:

```powershell
node --check tools/time/js/db.js
```

Expected: no output and exit code 0.

### Task 3: App Shell and UI

**Files:**
- Create: `tools/time/index.html`
- Create: `tools/time/css/style.css`
- Create: `tools/time/js/app.js`

- [ ] **Step 1: Build app shell**

Create semantic sections for `today`, `calendar`, `list`, and `profile`, plus a quick-add sheet and modal-style edit surfaces.

- [ ] **Step 2: Implement render and handlers**

Use `TodayYouxuDB`, `TodayYouxuDateUtils`, `TodayYouxuExport`, and `TodayYouxuState` from browser globals. Render the approved “今日优先” layout and keep all writes local-first.

- [ ] **Step 3: Syntax-check app**

Run:

```powershell
node --check tools/time/js/app.js
```

Expected: no output and exit code 0.

### Task 4: PWA Assets and Integration

**Files:**
- Create: `tools/time/manifest.json`
- Create: `tools/time/sw.js`
- Create: `tools/time/README.md`
- Modify: `index.html`
- Modify: `manifest.json`
- Modify: `sw.js`
- Modify: `vercel.json`

- [ ] **Step 1: Add PWA metadata and cache shell**

Use `start_url` and `scope` as `/tools/time/`, name as `今日有序`, and cache the app shell, CSS, and JS files.

- [ ] **Step 2: Add root integrations**

Add a tool card, manifest shortcut, root SW cached route, Vercel headers, and rewrite entries.

- [ ] **Step 3: Validate JSON and SW syntax**

Run:

```powershell
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); JSON.parse(require('fs').readFileSync('tools/time/manifest.json','utf8')); JSON.parse(require('fs').readFileSync('vercel.json','utf8'));"
node --check sw.js
node --check tools/time/sw.js
```

Expected: no output and exit code 0.

### Task 5: Full Verification

**Files:**
- Verify all files above.

- [ ] **Step 1: Run automated checks**

Run:

```powershell
node --test tools/time/js/date-utils.test.js tools/time/js/export.test.js tools/time/js/app-state.test.js
node --check tools/time/js/date-utils.js
node --check tools/time/js/export.js
node --check tools/time/js/app-state.js
node --check tools/time/js/db.js
node --check tools/time/js/app.js
node --check tools/time/sw.js
node --check sw.js
git diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Browser verification**

Serve the repository on a fresh local port and verify:

- `/tools/time/` loads the 今日视图.
- Adding a task with only a title persists after reload.
- Completing a task removes it from “现在要做”.
- Adding a habit allows a same-day check-in.
- Writing 今日一句 marks the selected date in the calendar.
- JSON export contains `tasks`, `habits`, `habitLogs`, `journals`, and `opLogs`.

- [ ] **Step 3: Commit**

Run:

```powershell
git add index.html manifest.json sw.js vercel.json tools/time docs/superpowers/plans/2026-07-02-today-youxu-tool.md
git commit -m "feat: add today youxu time tool"
```
