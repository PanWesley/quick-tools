const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const pages = [
  'tools/diff/index.html',
  'tools/json/index.html',
  'tools/expense/index.html',
  'tools/price/index.html',
  'tools/time/index.html'
];
const serviceWorkers = [
  'sw.js',
  'tools/expense/sw.js',
  'tools/price/sw.js',
  'tools/time/sw.js'
];

pages.forEach((pagePath) => {
  const html = fs.readFileSync(path.join(projectRoot, pagePath), 'utf8');
  assert.match(
    html,
    /<script src="\/shared\/js\/app-update\.js\?v=1"><\/script>/,
    `${pagePath} must load the shared app update runtime`
  );
  assert.match(
    html,
    /data-app-update-button/,
    `${pagePath} must expose a manual update button`
  );
  assert.match(
    html,
    /data-app-update-status/,
    `${pagePath} must expose update status text`
  );
});

serviceWorkers.forEach((workerPath) => {
  const worker = fs.readFileSync(path.join(projectRoot, workerPath), 'utf8');
  assert.match(
    worker,
    /addEventListener\('message'/,
    `${workerPath} must listen for update activation messages`
  );
  assert.match(
    worker,
    /SKIP_WAITING/,
    `${workerPath} must support immediate activation`
  );
});

[
  'sw.js',
  'tools/expense/sw.js',
  'tools/price/sw.js',
  'tools/time/sw.js'
].forEach((workerPath) => {
  const worker = fs.readFileSync(path.join(projectRoot, workerPath), 'utf8');
  assert.match(
    worker,
    /\/shared\/js\/app-update\.js(?:\?v=1)?/,
    `${workerPath} must cache the shared update runtime`
  );
});

console.log('app update asset tests passed');
