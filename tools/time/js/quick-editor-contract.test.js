const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

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
