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
