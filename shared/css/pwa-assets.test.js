const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const sharedCss = fs.readFileSync(path.join(projectRoot, 'shared', 'css', 'pwa.css'), 'utf8');

const toolPages = [
  'tools/diff/index.html',
  'tools/json/index.html',
  'tools/expense/index.html',
  'tools/price/index.html',
  'tools/time/index.html'
];

assert.match(
  sharedCss,
  /html,\s*body\s*\{\s*touch-action:\s*manipulation;\s*\}/,
  'shared PWA CSS must disable double-tap zoom while preserving scroll and pinch gestures'
);

toolPages.forEach((pagePath) => {
  const html = fs.readFileSync(path.join(projectRoot, pagePath), 'utf8');
  assert.match(
    html,
    /<link rel="stylesheet" href="\/shared\/css\/pwa\.css\?v=3">/,
    `${pagePath} must load the shared touch interaction CSS`
  );
});

console.log('shared PWA asset tests passed');
