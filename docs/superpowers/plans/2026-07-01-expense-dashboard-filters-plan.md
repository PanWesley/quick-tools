# Expense Dashboard Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the overview page use one global filter context and one shared analysis dimension for category share, Top 5, and trend charts.

**Architecture:** `chart.js` owns pure filtering and aggregation helpers plus chart rendering. `app.js` owns DOM state collection and hero rendering, but it reuses the same filtered dashboard dataset. `index.html` exposes a single chart analysis selector and removes the trend-only time selector.

**Tech Stack:** Static HTML/CSS/JavaScript, IndexedDB helper APIs from `db.js`, Chart.js, Node `assert` tests.

---

## File Structure

- Modify `tools/expense/js/chart.js`: add pure helpers `filterDashboardExpenses`, `aggregateDashboardBreakdown`, `aggregateDashboardTrend`, and update `updateDashboard`.
- Create `tools/expense/js/chart.test.js`: Node tests for the new pure helpers.
- Modify `tools/expense/js/app.js`: add dashboard analysis selector initialization and make hero stats use shared filtered expenses.
- Modify `tools/expense/index.html`: add the analysis selector, remove the trend selector.
- Modify release metadata after implementation: `tools/expense/index.html`, `tools/expense/README.md`, `tools/expense/CHANGELOG.md`, `tools/expense/sw.js`, and `tools/expense/css/style.css`.

### Task 1: Chart Data Helpers

**Files:**
- Create: `tools/expense/js/chart.test.js`
- Modify: `tools/expense/js/chart.js`

- [ ] **Step 1: Write failing tests**

```js
const assert = require('assert');
const {
  filterDashboardExpenses,
  aggregateDashboardBreakdown,
  aggregateDashboardTrend
} = require('./chart');

const tags = [
  { id: 'food', name: '餐饮', color: '#f39c12', parentId: 'group-category' },
  { id: 'snack', name: '零食', color: '#e67e22', parentId: 'group-category' },
  { id: 'wechat', name: '微信', color: '#2ecc71', parentId: 'group-payment' }
];
const groups = [
  { id: 'group-category', name: '消费类型', color: '#f39c12' },
  { id: 'group-payment', name: '支付方式', color: '#2ecc71' },
  { id: 'group-uncategorized', name: '未分类', color: '#95a5a6' }
];
const expenses = [
  { amount: 60, date: '2026-06-01', note: '午餐', category: '旧分类', tags: ['food', 'wechat'] },
  { amount: 30, date: '2026-06-02', note: '零食', category: '旧分类', tags: ['snack', 'wechat'] },
  { amount: 20, date: '2026-07-01', note: '晚餐', category: '旧分类', tags: ['food'] }
];

const filtered = filterDashboardExpenses(expenses, {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  tags: ['wechat'],
  search: '餐'
});
assert.deepStrictEqual(filtered.map(expense => expense.amount), [60]);

const categoryBreakdown = aggregateDashboardBreakdown(expenses.slice(0, 2), {
  tags,
  groups,
  analysisGroupId: 'group-category',
  topN: 5
});
assert.deepStrictEqual(categoryBreakdown.labels, ['餐饮', '零食']);
assert.deepStrictEqual(categoryBreakdown.data, [60, 30]);

const groupBreakdown = aggregateDashboardBreakdown(expenses.slice(0, 2), {
  tags,
  groups,
  analysisGroupId: 'all-groups',
  topN: 5
});
assert.deepStrictEqual(groupBreakdown.labels, ['消费类型', '支付方式']);
assert.deepStrictEqual(groupBreakdown.data, [45, 45]);

const trend = aggregateDashboardTrend(expenses, {
  startDate: '2026-06-01',
  endDate: '2026-07-31'
});
assert.deepStrictEqual(trend.labels, ['2026/06', '2026/07']);
assert.deepStrictEqual(trend.data, [90, 20]);

console.log('chart dashboard helper tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/expense/js/chart.test.js`

Expected: FAIL because `chart.js` does not export the requested helper functions.

- [ ] **Step 3: Implement helpers**

Add CommonJS-safe pure helpers to `chart.js`, then export them with `module.exports` while preserving browser globals.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/expense/js/chart.test.js`

Expected: PASS with `chart dashboard helper tests passed`.

### Task 2: Dashboard Rendering Uses Shared Context

**Files:**
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/js/app.js`
- Modify: `tools/expense/js/chart.js`

- [ ] **Step 1: Update markup**

Add a compact `<select id="dashboard-analysis-group">` near the chart heading controls. Remove `<select id="trend-time-range">`.

- [ ] **Step 2: Wire selector state**

Populate the selector from `allTagGroups`, default to `group-category`, and call `refreshDashboard()` when it changes.

- [ ] **Step 3: Update rendering**

Use `filterDashboardExpenses()` once in `updateDashboard()`. Render category share and Top 5 from `aggregateDashboardBreakdown()`. Render trend from `aggregateDashboardTrend()` using the same filtered expenses and top date range.

- [ ] **Step 4: Run focused checks**

Run: `node tools/expense/js/chart.test.js`

Expected: PASS.

### Task 3: Hero and Selected Tag Chips

**Files:**
- Modify: `tools/expense/js/app.js`

- [ ] **Step 1: Reuse filtered data for hero**

Replace the duplicated hero filter logic with `filterDashboardExpenses()` and the current resolved date range.

- [ ] **Step 2: Compact full-group chips**

When all tags in a group are selected, render one selected group chip. Removing it clears the child tag ids in that group. Partial groups still render individual tag chips.

- [ ] **Step 3: Run focused checks**

Run: `node tools/expense/js/chart.test.js`

Expected: PASS.

### Task 4: Release Sync and Verification

**Files:**
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/README.md`
- Modify: `tools/expense/CHANGELOG.md`
- Modify: `tools/expense/sw.js`
- Modify: `tools/expense/css/style.css`

- [ ] **Step 1: Sync release metadata**

Update user-visible version, stylesheet header, service worker cache name, README, and CHANGELOG for the dashboard filter release.

- [ ] **Step 2: Run automated verification**

Run:

```powershell
Get-ChildItem tools\expense\js -Filter *.test.js | ForEach-Object { node $_.FullName }
Get-ChildItem tools\expense\js -Filter *.js | ForEach-Object { node --check $_.FullName }
node --check tools\expense\sw.js
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Browser smoke test**

Serve the repo on a fresh local port with correct JavaScript MIME types, open `/tools/expense/#view=dashboard`, confirm the dashboard loads, the analysis selector appears, and changing top filters updates all charts.
