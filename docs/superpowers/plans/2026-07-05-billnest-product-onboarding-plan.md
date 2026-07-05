# BillNest Product Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished BillNest product welcome screen that introduces privacy-first onboarding, Excel import, install guidance, and AI-style analysis preview without repeatedly interrupting existing users.

**Architecture:** Add a focused `tools/expense/js/onboarding.js` helper for display policy and settings state. Add `#view-onboarding` to the existing static app shell, reuse existing navigation and import/settings APIs, and keep the experience local-only with CSS animations.

**Tech Stack:** Vanilla HTML, CSS, JavaScript, IndexedDB settings via existing `getSettings` / `setSettings`, Node `assert` tests.

---

### Task 1: Onboarding Display Policy

**Files:**
- Create: `tools/expense/js/onboarding.js`
- Create: `tools/expense/js/onboarding.test.js`

- [x] Write tests for the display decision: first empty launch shows, existing-data launch hides, explicit setting can show, and dismissal suppresses future automatic display.
- [x] Run the test and verify it fails before implementation.
- [x] Implement the helper functions.
- [x] Run the test and verify it passes.

### Task 2: Welcome UI

**Files:**
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/css/style.css`
- Modify: `tools/expense/sw.js`
- Modify: `tools/expense/js/expense-assets.test.js`

- [x] Add `#view-onboarding` before the existing dashboard/add views.
- [x] Add script loading and service worker cache entry for `onboarding.js`.
- [x] Add animated CSS for the welcome hero and analysis section.
- [x] Extend asset tests to require the onboarding script.

### Task 3: App Integration And Settings

**Files:**
- Modify: `tools/expense/js/app.js`
- Modify: `tools/expense/index.html`

- [x] Decide startup view after data initialization using the onboarding helper.
- [x] Mark onboarding seen when the user starts, imports, tries demo data, or dismisses.
- [x] Add settings toggle for startup welcome screen and a button to view it manually.
- [x] Keep old users friendly: users with existing expenses do not see onboarding automatically unless they enable the setting.

### Task 4: Verification

**Files:**
- Test: `tools/expense/js/onboarding.test.js`
- Test: `tools/expense/js/expense-assets.test.js`

- [x] Run targeted Node tests.
- [x] Run syntax/config checks where relevant.
- [x] Start a local static server and visually check onboarding and settings flow.
