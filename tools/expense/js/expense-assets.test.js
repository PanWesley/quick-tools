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

const appDependencyScripts = [
  '/tools/expense/js/onboarding.js'
];

const analyticsScripts = [
  '/shared/js/site-analytics-utils.js',
  '/shared/js/site-analytics.js'
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
analyticsScripts.forEach((source) => {
  assert.ok(
    scriptSources.indexOf(source) > appIndex,
    `${source} must load after app.js so it can wrap app navigation without blocking startup`
  );
  assert.match(
    serviceWorker,
    new RegExp(`['"]${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
    `${source} must be cached by the service worker`
  );
});
appDependencyScripts.forEach((source) => {
  assert.ok(
    scriptSources.indexOf(source) < appIndex,
    `${source} must load before app.js`
  );
  assert.match(
    serviceWorker,
    new RegExp(`['"]${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
    `${source} must be cached by the service worker`
  );
});
assert.ok(
  scriptSources.indexOf('/shared/js/site-analytics-utils.js') <
  scriptSources.indexOf('/shared/js/site-analytics.js'),
  'analytics runtime must load after analytics utility helpers'
);

assert.match(
  serviceWorker,
  /const CACHE_NAME = 'expense-tracker-v1\.6\.13';/
);
assert.match(
  html,
  /\/tools\/expense\/css\/style\.css\?v=173/,
  'main expense stylesheet must use the current asset version'
);
assert.match(
  serviceWorker,
  /url\.pathname\.startsWith\('\/api\/analytics'\)/,
  'analytics API requests must stay network-only and out of the static cache'
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
  /'\/tools\/expense\/assets\/billnest-lifestyle-journal\.png'/,
  'project-bound onboarding visual asset must be available offline'
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
assert.strictEqual(
  (html.match(/id="insight-alert-list"/g) || []).length,
  1,
  'dashboard alert list id must be unique'
);
assert.match(
  html,
  /data-template-label="咖啡 18"/,
  'add view should expose warm default quick templates for first-time users'
);
assert.match(
  html,
  /<span class="setting-title">主题色<\/span>/,
  'appearance settings should expose an accent color setting'
);
['forest', 'blush', 'apricot', 'sage'].forEach((accent) => {
  assert.match(
    html,
    new RegExp(`name="accent-color" value="${accent}"`),
    `accent color setting should include ${accent} preset`
  );
});
assert.match(
  html,
  /function applyAccentColorPreference\(preference\)/,
  'accent color preference should be applied before normal app startup'
);
assert.match(
  stylesheet,
  /\.accent-swatch/,
  'accent color setting should render visible swatches'
);
const darkBodyBackgroundRule = stylesheet.match(/\[data-theme="dark"\]\s+body\s*\{([\s\S]*?)\n\}/);
assert.ok(darkBodyBackgroundRule, 'dark theme should define its own body background');
assert.doesNotMatch(
  darkBodyBackgroundRule[1],
  /255,\s*247,\s*242|248,\s*246,\s*242/,
  'dark theme body background must not reuse the light warm gradient'
);
assert.match(html, /id="backup-restore-modal"/);
assert.match(html, /id="backup-encrypted-modal"/);
assert.match(html, /<h3>表格导入<\/h3>/);
assert.match(
  stylesheet,
  /\.safety-more\[hidden\]\s*\{\s*display:\s*none/
);
assert.match(
  stylesheet,
  /\.list-category-trigger-count\[hidden\]\s*\{\s*display:\s*none/,
  'hidden list category count badge must not leave an empty green dot'
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
const firstVisitIndex = appSource.indexOf('const expenses = await getExpenses();');
assert.ok(
  initialHashIndex !== -1 && firstVisitIndex !== -1 && initialHashIndex < firstVisitIndex,
  'initial hash route should switch the visible shell before first-visit data work'
);
assert.match(
  appSource,
  /if \(show && initialView === 'add' && !shouldShowProductOnboarding\)/,
  'first-visit guide should not steal non-add hash routes during startup'
);
assert.match(
  appSource,
  /BillNestOnboarding/,
  'startup should consult BillNest onboarding display policy'
);
assert.doesNotMatch(
  appSource,
  /await enableDemoMode\(\);\s*\/\/ Refresh in-memory tag state/,
  'new users should choose demo mode from onboarding instead of getting demo data automatically'
);

console.log('expense asset loading tests passed');
