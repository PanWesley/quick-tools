# Today Youxu Local Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add task editing, soft-delete recovery, and safe JSON import/merge to 今日有序.

**Architecture:** Keep the app static and local-first. Put import validation and merge rules into a pure utility module with Node tests, extend IndexedDB with restore/import methods, then wire small UI additions into the existing app shell.

**Tech Stack:** HTML, CSS, browser JavaScript, IndexedDB, Node built-in `node:test`.

---

## File Structure

- Create `tools/time/js/import-utils.js`: validation, summary, record merge, import result builder.
- Create `tools/time/js/import-utils.test.js`: TDD tests for import validation and merge behavior.
- Modify `tools/time/js/db.js`: add `restoreTask(id)` and `importData(payload)`.
- Modify `tools/time/js/app-state.js`: add `getDeletedTasks(tasks)`.
- Modify `tools/time/js/app-state.test.js`: test deleted task grouping.
- Modify `tools/time/index.html`: add import controls, deleted list, edit form mode hooks.
- Modify `tools/time/js/app.js`: add task edit, task restore, JSON import handling, deleted list render.
- Modify `tools/time/css/style.css`: action rows, deleted section, import controls.
- Modify `tools/time/README.md`: note JSON import and restore behavior.

## Tasks

### Task 1: Import Utility Tests and Implementation

**Files:**
- Create: `tools/time/js/import-utils.test.js`
- Create: `tools/time/js/import-utils.js`

- [x] **Step 1: Write failing tests**

Create `tools/time/js/import-utils.test.js` with tests for:

- accepting `{ app: "today-youxu", version: 1 }`
- rejecting wrong app/version
- summarizing store counts
- merging newer incoming records
- keeping newer local records
- skipping incoming records without id

- [x] **Step 2: Run tests to verify red**

Run:

```powershell
node --test tools/time/js/import-utils.test.js
```

Expected: fail because `import-utils.js` does not exist.

- [x] **Step 3: Implement import utility**

Create `tools/time/js/import-utils.js` exporting:

- `validateImportPayload(payload)`
- `summarizeImportPayload(payload)`
- `mergeRecords(localRecords, incomingRecords)`
- `buildImportResult(localData, incomingPayload)`

- [x] **Step 4: Run tests to verify green**

Run:

```powershell
node --test tools/time/js/import-utils.test.js
```

Expected: all import utility tests pass.

### Task 2: State and DB Extensions

**Files:**
- Modify: `tools/time/js/app-state.js`
- Modify: `tools/time/js/app-state.test.js`
- Modify: `tools/time/js/db.js`

- [x] **Step 1: Add failing state test**

Extend `tools/time/js/app-state.test.js` with a test proving `getDeletedTasks()` returns deleted tasks sorted by newest `deletedAt`.

- [x] **Step 2: Run app-state tests to verify red**

Run:

```powershell
node --test tools/time/js/app-state.test.js
```

Expected: fail because `getDeletedTasks` is not exported.

- [x] **Step 3: Implement state and DB methods**

Add `getDeletedTasks(tasks)` to `app-state.js`.

Add to `db.js`:

- `restoreTask(id)`
- `importData(payload)`

`importData()` should call `TodayYouxuImport.buildImportResult()`, write merged stores in a transaction, and append an import OpLog.

- [x] **Step 4: Run tests and syntax checks**

Run:

```powershell
node --test tools/time/js/app-state.test.js tools/time/js/import-utils.test.js
node --check tools/time/js/db.js
```

Expected: pass.

### Task 3: UI Wiring

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/css/style.css`
- Modify: `tools/time/README.md`

- [x] **Step 1: Add UI controls**

Add:

- hidden task edit mode field/state in existing quick sheet.
- Edit buttons in task rows.
- Restore buttons in deleted rows.
- `recently-deleted-list` section in the list view.
- `import-button` and `import-file` in profile local data area.
- `/tools/time/js/import-utils.js?v=100` script tag before `db.js`.

- [x] **Step 2: Wire app behavior**

Add app handlers for:

- opening edit mode with existing task values.
- saving edits through `DB.updateTask`.
- restoring via `DB.restoreTask`.
- importing JSON via file input and `DB.importData`.
- rendering import result summary.

- [x] **Step 3: Syntax-check app**

Run:

```powershell
node --check tools/time/js/app.js
```

Expected: pass.

### Task 4: Verification and Commit

**Files:**
- Verify all modified files.

- [x] **Step 1: Run automated checks**

Run:

```powershell
node --test tools/time/js/date-utils.test.js tools/time/js/export.test.js tools/time/js/app-state.test.js tools/time/js/import-utils.test.js
node --check tools/time/js/date-utils.js
node --check tools/time/js/export.js
node --check tools/time/js/import-utils.js
node --check tools/time/js/app-state.js
node --check tools/time/js/db.js
node --check tools/time/js/app.js
node --check tools/time/sw.js
node --check sw.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); JSON.parse(require('fs').readFileSync('tools/time/manifest.json','utf8')); JSON.parse(require('fs').readFileSync('vercel.json','utf8'));"
git diff --check
```

Expected: pass.

- [x] **Step 2: Browser verification**

On a fresh local port:

- Create a task.
- Edit title/date/priority/notes.
- Delete task and verify it appears in recently deleted.
- Restore task and verify it returns to active lists.
- Export JSON, import it, and see import result.
- Try invalid JSON and see rejection.

- [x] **Step 3: Commit**

Run:

```powershell
git add docs/superpowers/plans/2026-07-02-today-youxu-local-reliability.md tools/time
git commit -m "feat: improve today youxu local reliability"
```
