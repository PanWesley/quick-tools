import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/deploy-production.yml', import.meta.url),
  'utf8',
);
const vercel = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
);

test('production deploy serializes Worker before Vercel', () => {
  assert.match(workflow, /push:\s*[\s\S]*branches:\s*\[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /concurrency:\s*[\s\S]*cancel-in-progress:\s*false/);
  assert.match(
    workflow,
    /deploy-vercel:\s*[\s\S]*needs:\s*deploy-notifications/,
  );
  assert.ok(
    workflow.indexOf('pnpm exec wrangler deploy')
      < workflow.indexOf('vercel deploy --prebuilt --prod'),
  );
});

test('production deploy references only named GitHub secrets', () => {
  for (const name of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'VERCEL_TOKEN',
    'VERCEL_ORG_ID',
    'VERCEL_PROJECT_ID',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${name}\\b`));
  }
  assert.doesNotMatch(workflow, /VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)/);
});

test('Vercel keeps previews but does not race main production', () => {
  assert.equal(vercel.git.deploymentEnabled.main, false);
  assert.equal(vercel.git.deploymentEnabled['*'], true);
});
