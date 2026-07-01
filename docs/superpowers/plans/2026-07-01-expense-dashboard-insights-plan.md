# Expense Dashboard Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add spending pace, calendar heatmap, and anomaly reminder modules to the expense overview dashboard.

**Architecture:** Pure data helpers live in `chart.js` and are covered by `chart.test.js`. `app.js` renders the insight modules using the same filtered dashboard dataset already produced for charts. `index.html` and `style.css` add compact UI containers without introducing new filter state.

**Tech Stack:** Static HTML/CSS/JavaScript, IndexedDB helper APIs, Chart.js, Node `assert` tests.

---

### Task 1: Pure Insight Helpers

**Files:**
- Modify: `tools/expense/js/chart.test.js`
- Modify: `tools/expense/js/chart.js`

- [ ] **Step 1: Write failing tests** for `buildSpendingPace`, `buildCalendarHeatmap`, and `buildDashboardInsightCards`.
- [ ] **Step 2: Run `node tools/expense/js/chart.test.js` and verify it fails** because helpers are not exported.
- [ ] **Step 3: Implement minimal helpers** in `chart.js`.
- [ ] **Step 4: Run `node tools/expense/js/chart.test.js` and verify it passes**.

### Task 2: Dashboard Insight UI

**Files:**
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/js/app.js`
- Modify: `tools/expense/css/style.css`

- [ ] **Step 1: Add dashboard insight containers** after the hero and before existing chart rows.
- [ ] **Step 2: Render pace, heatmap, and insight cards** from `renderDashboardHero()` after the filtered dataset is available.
- [ ] **Step 3: Keep empty states calm** when there are no expenses.
- [ ] **Step 4: Verify with `node --check tools/expense/js/app.js` and `node --check tools/expense/js/chart.js`**.

### Task 3: Release Sync and Verification

**Files:**
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/README.md`
- Modify: `tools/expense/CHANGELOG.md`
- Modify: `tools/expense/sw.js`
- Modify: `tools/expense/css/style.css`
- Modify: `tools/expense/js/expense-assets.test.js`

- [ ] **Step 1: Bump release metadata to `v1.6.4`**.
- [ ] **Step 2: Run all JS tests, syntax checks, service worker check, and `git diff --check`**.
- [ ] **Step 3: Browser smoke test `/tools/expense/#view=dashboard` on a fresh local port**.
