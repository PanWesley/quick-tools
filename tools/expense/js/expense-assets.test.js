const assert = require('assert');
const fs = require('fs');
const path = require('path');

const expenseRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(expenseRoot, '..', '..');
const html = fs.readFileSync(path.join(expenseRoot, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(expenseRoot, 'sw.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(expenseRoot, 'css', 'style.css'), 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'));

const requiredScripts = [
  '/tools/expense/js/backup-utils.js',
  '/tools/expense/js/backup-crypto.js',
  '/tools/expense/js/backup-file-handle-db.js',
  '/tools/expense/js/backup-service.js',
  '/tools/expense/js/backup-ui.js'
];

const scriptSources = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
  .map(match => match[1].replace(/\?.*$/, ''));
assert.ok(
  !scriptSources.some(source => source.includes('chart.js@') || source.includes('chart.umd')),
  'Chart.js CDN must not block the installed app startup'
);
assert.ok(
  !scriptSources.some(source => source.includes('xlsx@') || source.includes('xlsx.full')),
  'SheetJS CDN must be lazy-loaded only when importing Excel files'
);
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
  /const CACHE_NAME = 'expense-tracker-v1\.6\.3';/
);
assert.match(
  serviceWorker,
  /caches\.match\(request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/,
  'offline fallback must match versioned asset requests against unversioned precache keys'
);
assert.match(
  serviceWorker,
  /const cachedResponse = await caches\.match\(request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/,
  'service worker must check cache before waiting on the network'
);
assert.match(
  serviceWorker,
  /event\.waitUntil\(refreshCachedRequest\(request\)\)/,
  'cached responses must refresh in the background'
);

const staticHeaderRule = vercelConfig.headers.find(rule => (
  rule.source === '/tools/expense/(.*)\\.(css|js)'
));
assert.ok(staticHeaderRule, 'Vercel must define an expense CSS/JS header rule');
const staticCacheHeader = staticHeaderRule.headers.find(header => header.key === 'Cache-Control');
assert.ok(staticCacheHeader, 'expense CSS/JS rule must define Cache-Control');
assert.match(
  staticCacheHeader.value,
  /max-age=31536000/,
  'versioned expense CSS/JS assets should use a long browser cache lifetime'
);
assert.match(
  staticCacheHeader.value,
  /immutable/,
  'versioned expense CSS/JS assets should be immutable'
);

assert.match(html, /id="dashboard-attention"[^>]*hidden/);
assert.match(html, /id="backup-restore-modal"/);
assert.match(html, /id="backup-encrypted-modal"/);
assert.match(html, /<h3>表格导入<\/h3>/);
assert.match(
  stylesheet,
  /\.safety-more\[hidden\]\s*\{\s*display:\s*none/
);
assert.doesNotMatch(
  stylesheet,
  /@import\s+url\(['"]?https?:\/\//,
  'startup stylesheet must not block on remote font imports'
);

const appSource = fs.readFileSync(path.join(expenseRoot, 'js', 'app.js'), 'utf8');
assert.match(appSource, /ExpenseBackupUI\.refresh\(\)/);
assert.match(appSource, /visibilitychange/);
assert.doesNotMatch(
  appSource,
  /\/\/ Initial dashboard render\s+await refreshDashboard\(\);/,
  'startup must not render the dashboard before the dashboard view is opened'
);
assert.doesNotMatch(
  appSource,
  /\/\/ Re-render after potential demo mode init[\s\S]*?await renderExpenseList\(\);\s*await refreshDashboard\(\);/,
  'startup must not render list and dashboard before those views are opened'
);
const initialHashIndex = appSource.indexOf('const initialHash = window.location.hash;');
const firstVisitIndex = appSource.indexOf('// First visit: use enableDemoMode()');
assert.ok(
  initialHashIndex !== -1 && firstVisitIndex !== -1 && initialHashIndex < firstVisitIndex,
  'initial hash route should switch the visible shell before first-visit data work'
);
assert.match(
  appSource,
  /if \(show && initialView === 'add'\)/,
  'first-visit guide should not steal non-add hash routes during startup'
);

console.log('expense asset loading tests passed');
