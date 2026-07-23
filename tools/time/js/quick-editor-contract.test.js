const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

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

test('editor resets the static sheet transform and keeps screen-reader labels accessible', () => {
  assert.match(css, /\.quick-sheet-v2\s*\{[^}]*transform:\s*none;/s);
  assert.match(css, /\.quick-sheet-v2\.is-dragging\s*\{[^}]*transform:/s);
  assert.match(css, /\.sr-only\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*overflow:\s*hidden;/s);
});

test('date parent panel expands to expose its settings in a 390 by 844 viewport', () => {
  assert.match(css, /\.quick-sheet-v2:has\(\.quick-extra-panel:not\(\[hidden\]\)\)\s*\{[^}]*max-height:\s*calc\(var\(--quick-viewport-height,\s*100vh\)\s*-\s*4px\);/s);
  assert.match(css, /\.quick-extra-panel\s*\{[^}]*max-height:\s*min\(74vh,\s*calc\(var\(--quick-viewport-height,\s*100vh\)\s*-\s*226px\)\);/s);
  assert.match(css, /\.quick-date-settings button\s*\{[^}]*min-height:\s*52px;/s);
  assert.match(css, /\.quick-date-child-head button\s*\{[^}]*min-height:\s*44px;/s);
});

test('app coordinates scroll lock, draft storage and swipe suppression', () => {
  assert.match(app, /today-youxu-quick-draft-v1/);
  assert.match(app, /function lockQuickEditorScroll/);
  assert.match(app, /function unlockQuickEditorScroll/);
  assert.match(app, /if \(isQuickEditorOpen\(\)\) return;/);
  assert.match(app, /visualViewport.*quick-viewport-height/s);
});

test('app limits sheet dismissal to the drag handle and cleans up every pointer end', () => {
  assert.match(app, /els\.quickDragHandle\.addEventListener\('pointerdown'/);
  assert.match(app, /els\.quickDragHandle\.addEventListener\('pointercancel'/);
  assert.match(app, /classList\.add\('is-dragging'\)/);
  assert.match(app, /style\.setProperty\('--quick-drag-offset'/);
  assert.match(app, /function closeQuickSession/);
  assert.match(app, /function persistCreateDraft/);
});

test('app isolates edit end dates and resets drag state when a session closes', () => {
  assert.match(app, /function openEditTask[\s\S]*els\.quickEndDate\.value = task\.endDate \|\| task\.date \|\| '';/);
  assert.match(app, /function openEditHabit[\s\S]*els\.quickEndDate\.value = habit\.startDate \|\| appState\.todayKey;/);
  assert.match(app, /function closeQuickSession[\s\S]*quickDrag = null;[\s\S]*classList\.remove\('is-dragging'\)[\s\S]*removeProperty\('--quick-drag-offset'\)/);
});

test('save payload and edit restoration include endDate', () => {
  assert.match(app, /endDate:\s*els\.quickEndDate\.value/);
  assert.match(app, /els\.quickEndDate\.value\s*=\s*task\.endDate\s*\|\|\s*task\.date/);
  assert.match(app, /clearCreateDraft\(\)/);
});

test('detail exits synchronously to focused keyboard surface', () => {
  assert.match(app, /CLOSE_DETAIL/);
  assert.match(app, /function openQuickFullPanel[\s\S]*els\.quickSheet\.hidden\s*=\s*true/);
  assert.match(app, /if \(els\.quickFullSave\)[\s\S]{0,300}closeQuickFullPanel\(\{ focusTitle: true \}\)/);
  assert.doesNotMatch(app, /setTimeout\(function\(\)\s*\{\s*openQuickTool/s);
});

test('detail back clears the toolbar surface before it returns focus to the title', () => {
  assert.match(app, /function renderQuickSurface[\s\S]{0,500}button\.setAttribute\('aria-pressed', String\(open\)\)[\s\S]{0,300}state\.surface === 'keyboard'[\s\S]{0,200}els\.quickExtraPanel\.hidden = true/s);
  assert.match(app, /function closeQuickFullPanel[\s\S]{0,500}CLOSE_DETAIL[\s\S]{0,500}els\.quickSheet\.inert = false;[\s\S]{0,120}renderQuickSurface\(\);[\s\S]{0,300}focusQuickTitle\(\)/s);
});

test('calendar endpoint times and full-detail focus survive narrow surfaces', () => {
  assert.match(app, /calendar-strip-time/);
  assert.match(app, /calendar-strip-title/);
  assert.match(app, /function calendarEntryLabel/);
  assert.match(css, /\.calendar-strip-time\s*\{[^}]*flex-shrink:\s*0;/s);
  assert.match(css, /\.calendar-strip-title\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(app, /function openQuickFullPanel[\s\S]{0,700}els\.quickFullPanel\.hidden\s*=\s*false;[\s\S]{0,300}els\.quickFullBack\.focus\(\)/);
});
