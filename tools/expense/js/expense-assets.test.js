const assert = require('assert');
const fs = require('fs');
const path = require('path');

const expenseRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(expenseRoot, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(expenseRoot, 'sw.js'), 'utf8');

const requiredScripts = [
  '/tools/expense/js/backup-utils.js',
  '/tools/expense/js/backup-crypto.js',
  '/tools/expense/js/backup-file-handle-db.js',
  '/tools/expense/js/backup-service.js',
  '/tools/expense/js/backup-ui.js'
];

const scriptSources = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
  .map(match => match[1].replace(/\?.*$/, ''));
const appIndex = scriptSources.indexOf('/tools/expense/js/app.js');
const firstBackupScriptIndex = scriptSources.indexOf(requiredScripts[0]);

assert.notStrictEqual(appIndex, -1, 'app.js must be loaded');
assert.notStrictEqual(
  firstBackupScriptIndex,
  -1,
  `${requiredScripts[0]} must be loaded`
);
requiredScripts.forEach((source, index) => {
  assert.strictEqual(
    scriptSources.indexOf(source),
    firstBackupScriptIndex + index,
    `${source} must be loaded in backup dependency order`
  );
  assert.ok(
    scriptSources.indexOf(source) < appIndex,
    `${source} must be loaded before app.js`
  );
  assert.match(
    serviceWorker,
    new RegExp(`['"]${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
    `${source} must be cached by the service worker`
  );
});

assert.match(
  serviceWorker,
  /const CACHE_NAME = 'expense-tracker-v1\.5\.7-safety3';/
);
assert.match(
  serviceWorker,
  /caches\.match\(request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/,
  'offline fallback must match versioned asset requests against unversioned precache keys'
);

assert.match(html, /id="dashboard-attention"[^>]*hidden/);
assert.match(html, /id="backup-restore-modal"/);
assert.match(html, /id="backup-encrypted-modal"/);
assert.match(html, /<h3>表格导入<\/h3>/);
assert.match(
  fs.readFileSync(path.join(expenseRoot, 'css', 'style.css'), 'utf8'),
  /\.safety-more\[hidden\]\s*\{\s*display:\s*none/
);

const appSource = fs.readFileSync(path.join(expenseRoot, 'js', 'app.js'), 'utf8');
assert.match(appSource, /ExpenseBackupUI\.refresh\(\)/);
assert.match(appSource, /visibilitychange/);

console.log('expense asset loading tests passed');
