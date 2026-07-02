# Today Youxu Bright Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 今日有序 feel brighter and more feminine while fixing oversized task rows and enriching the calendar page.

**Architecture:** Keep the app static and local-first. Add small pure state helpers for display-safe task titles and calendar day entries, then update rendering and CSS to use compact rows and pastel calendar event strips.

**Tech Stack:** HTML, CSS, browser JavaScript, IndexedDB, Node built-in `node:test`.

---

## File Structure

- Modify `tools/time/js/app-state.js`: add title fallback and calendar entry helpers.
- Modify `tools/time/js/app-state.test.js`: cover fallback titles and calendar entry summaries.
- Modify `tools/time/js/app.js`: render compact date-detail rows, pastel calendar strips, and a "today" month action.
- Modify `tools/time/index.html`: adjust calendar header controls.
- Modify `tools/time/css/style.css`: introduce the bright "晨光手账" theme, compact task layout, dense month calendar, and safer mobile sizing.
- Modify `tools/time/README.md`: document the refreshed visual and calendar behavior.
- Modify `tools/time/CHANGELOG.md`: add the new UI release entry.

## Tasks

### Task 1: State Helpers

- [x] Write failing tests for `getTaskDisplayTitle()` and `getCalendarEntries()`.
- [x] Run `node --test tools/time/js/app-state.test.js` and confirm the helpers are missing.
- [x] Implement the helpers in `tools/time/js/app-state.js`.
- [x] Re-run `node --test tools/time/js/app-state.test.js` and confirm the tests pass.

### Task 2: Calendar and Task Rendering

- [x] Update `tools/time/js/app.js` so calendar cells render up to two event strips and selected-date detail rows use compact rows.
- [x] Add a "今" control that returns the calendar to the current month and selected date.
- [x] Run `node --check tools/time/js/app.js`.

### Task 3: Visual Refresh

- [x] Update `tools/time/index.html` calendar controls and keep existing IDs stable.
- [x] Rewrite the relevant CSS tokens and components in `tools/time/css/style.css` for the bright hand-journal direction.
- [x] Verify mobile task rows, date detail rows, FAB, and bottom nav do not overlap.

### Task 4: Documentation and Verification

- [x] Update `tools/time/README.md` and `tools/time/CHANGELOG.md` in Chinese.
- [x] Run all time-tool tests and syntax checks.
- [x] Use a fresh local URL/browser pass to inspect `/tools/time/#calendar` and check console errors and overflow.
