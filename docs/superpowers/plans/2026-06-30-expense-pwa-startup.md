# Expense PWA Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installed expense PWA open from cache quickly while keeping updates and release metadata reliable.

**Architecture:** Keep the app static and local-first. Change the expense service worker to serve cached same-origin assets immediately and refresh them in the background, move large third-party libraries behind runtime loaders, and avoid rendering dashboard/list data until those views are opened.

**Tech Stack:** Static HTML/CSS/JavaScript, Service Worker Cache API, IndexedDB, Vercel headers, Node assert-based tests.

---

### Task 1: Lock Startup Asset Expectations

**Files:**
- Modify: `tools/expense/js/expense-assets.test.js`
- Test: `tools/expense/js/expense-assets.test.js`

- [ ] **Step 1: Write failing assertions**

Add assertions that `index.html` does not load Chart.js or SheetJS in blocking script tags, `sw.js` contains a cache-first stale refresh path, `vercel.json` gives versioned JS/CSS long-lived immutable caching, and `app.js` does not eagerly call `refreshDashboard()` or `renderExpenseList()` during initial boot.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools\expense\js\expense-assets.test.js`
Expected: FAIL because the current page still has blocking CDN scripts and network-first service worker behavior.

### Task 2: Implement Cache-First Startup

**Files:**
- Modify: `tools/expense/sw.js`
- Modify: `vercel.json`

- [ ] **Step 1: Update service worker**

Serve same-origin GET requests from cache first with `ignoreSearch: true`, fetch in the background to keep the cache fresh, and fall back to network when there is no cached response.

- [ ] **Step 2: Update Vercel headers**

Give `/tools/expense/*.js` and `/tools/expense/*.css` long-lived immutable browser caching because URLs already include `?v=` versions. Keep HTML short-cache/no-cache so app shell updates still arrive.

- [ ] **Step 3: Run asset test**

Run: `node tools\expense\js\expense-assets.test.js`
Expected: remaining failures only for blocking third-party scripts or eager app boot.

### Task 3: Lazy Load Heavy Libraries and Views

**Files:**
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/js/app.js`
- Modify: `tools/expense/js/chart.js`
- Modify: `tools/expense/js/import-export.js`

- [ ] **Step 1: Remove blocking CDN scripts**

Remove the head-level Chart.js and SheetJS scripts. Add a small deferred loader script or runtime helpers that load Chart.js only when dashboard rendering needs charts, and SheetJS only before parsing Excel files.

- [ ] **Step 2: Avoid eager non-active rendering**

During `DOMContentLoaded`, initialize only database, tags, filters, form, settings, and route handling. Render dashboard and list only when their views are opened or when a hash route requests them.

- [ ] **Step 3: Run asset test**

Run: `node tools\expense\js\expense-assets.test.js`
Expected: PASS.

### Task 4: Release Sync and Verification

**Files:**
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/css/style.css`
- Modify: `tools/expense/sw.js`
- Modify: `tools/expense/README.md`
- Modify: `tools/expense/CHANGELOG.md`

- [ ] **Step 1: Bump version metadata**

Update the app version badge, service worker cache name, CSS header comment, README, and CHANGELOG to the same new release version.

- [ ] **Step 2: Run verification**

Run:
`node tools\expense\js\*.test.js`
`node --check tools\expense\sw.js`
`git diff --check`

Expected: all pass.
