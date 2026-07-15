# Production Deployment Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one GitHub Actions workflow deploy the Notifications Worker successfully before publishing the same `main` commit to Vercel production.

**Architecture:** GitHub Actions becomes the production release controller. The first job tests, dry-runs, and deploys `workers/notifications/`; a dependent second job uses Vercel CLI 56.2.0 to build and publish the checked-out commit. `vercel.json` disables Vercel's direct Git production deployment for `main` while preserving branch previews.

**Tech Stack:** GitHub Actions, Node.js 24, pnpm 10, Wrangler 4.110.0, Vercel CLI 56.2.0, Cloudflare Workers/D1, Vercel static hosting, Node built-in test runner.

## Global Constraints

- GitHub Actions is the only production release controller for `main`.
- Cloudflare Worker tests, dry-run, and deployment must finish before Vercel production starts.
- A Worker failure must skip Vercel deployment and leave the existing PWA active.
- PR preview deployments must remain enabled.
- Production deployments use one non-cancelling concurrency group.
- Do not create or migrate D1 and do not rotate VAPID keys.
- Never write credential values to Git, local files, chat, screenshots, or logs.
- Existing VAPID runtime secrets remain only in Cloudflare.

---

## File Map

- `.github/workflows/deploy-production.yml`: sole ordered production workflow.
- `scripts/production-deploy.test.mjs`: static contract tests for workflow ordering, secret references, and Vercel Git behavior.
- `vercel.json`: keeps preview Git deployments but disables direct Git deployment for `main`.
- `workers/README.md`: documents automated release, secret names, rotation, failure behavior, and rollback.

---

### Task 1: Lock The Production Deployment Contract

**Files:**
- Create: `scripts/production-deploy.test.mjs`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: workflow source at `.github/workflows/deploy-production.yml` and parsed `vercel.json`.
- Produces: an executable contract test that fails unless Cloudflare precedes Vercel and `main` Git production is disabled.

- [ ] **Step 1: Add the failing contract test**

Create a Node test that reads the workflow as text and `vercel.json` as structured JSON. It must assert:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('production deploy serializes Worker before Vercel', () => {
  const workerDeployIndex = workflow.indexOf('pnpm exec wrangler deploy');
  const vercelDeployIndex = workflow.indexOf('vercel deploy --prebuilt --prod');

  assert.match(workflow, /push:\s*[\s\S]*branches:\s*\[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /concurrency:\s*[\s\S]*cancel-in-progress:\s*false/);
  assert.match(workflow, /deploy-vercel:\s*[\s\S]*needs:\s*deploy-notifications/);
  assert.ok(workerDeployIndex >= 0);
  assert.ok(vercelDeployIndex > workerDeployIndex);
});

test('production deploy references only named GitHub secrets', () => {
  for (const name of [
    'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
    'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'
  ]) assert.match(workflow, new RegExp(`secrets\\.${name}\\b`));
  assert.doesNotMatch(workflow, /VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)/);
});

test('Vercel keeps previews but does not race main production', () => {
  assert.deepEqual(vercel.git.deploymentEnabled, { main: false });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test scripts/production-deploy.test.mjs
```

Expected: FAIL because the workflow does not exist and `vercel.json` has no `git.deploymentEnabled` contract.

- [ ] **Step 3: Add Vercel Git deployment policy**

Add this top-level property without changing existing headers, redirects, or rewrites:

```json
"git": {
  "deploymentEnabled": {
    "main": false
  }
}
```

Unspecified branches remain enabled by Vercel's default behavior. Do not add a
`"*": true` rule: `main` would match both rules, and any matching `true` rule
causes an automatic deployment.

- [ ] **Step 4: Run the test and confirm it still fails only on the missing workflow**

Run:

```bash
node --test scripts/production-deploy.test.mjs
```

Expected: FAIL because `.github/workflows/deploy-production.yml` is absent; JSON parsing succeeds.

---

### Task 2: Implement The Ordered GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/deploy-production.yml`
- Test: `scripts/production-deploy.test.mjs`

**Interfaces:**
- Consumes: five GitHub Actions secrets and the Worker lockfile.
- Produces: jobs `deploy-notifications` and `deploy-vercel`, where the second has `needs: deploy-notifications`.

- [ ] **Step 1: Create the production workflow**

Use this exact job structure:

```yaml
name: Deploy production

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: production-deploy
  cancel-in-progress: false

jobs:
  deploy-notifications:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: workers/notifications
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: workers/notifications/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm check
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: pnpm exec wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy-vercel:
    needs: deploy-notifications
    runs-on: ubuntu-latest
    env:
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install --global vercel@56.2.0
      - run: vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
      - run: vercel build --prod --token="$VERCEL_TOKEN"
      - run: vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
```

- [ ] **Step 2: Run contract and syntax checks**

Run:

```bash
node --test scripts/production-deploy.test.mjs
node -e "JSON.parse(require('fs').readFileSync('vercel.json', 'utf8'))"
```

Expected: all contract tests pass and JSON parsing exits 0.

- [ ] **Step 3: Run existing deployment verification**

Run:

```bash
node --test tools/time/js/*.test.js
cd workers/notifications
pnpm test
pnpm check
```

Expected: Time and Worker suites have zero failures; Wrangler prints `--dry-run: exiting now`.

- [ ] **Step 4: Commit workflow code**

```bash
git add .github/workflows/deploy-production.yml scripts/production-deploy.test.mjs vercel.json
git commit -m "ci: deploy Worker before production PWA"
```

---

### Task 3: Create Scoped Deployment Credentials In Chrome

**Files:**
- No repository files.

**Interfaces:**
- Consumes: logged-in Cloudflare, Vercel, and GitHub browser sessions.
- Produces: five GitHub Actions Secrets with fixed names; no plaintext values returned.

- [ ] **Step 1: Create the Cloudflare API token**

In Cloudflare, create a custom token named `quick-tools-github-actions` scoped to the current account and `billnest.top`. Grant only the permissions required for Worker script deployment and Worker route updates. Do not grant DNS edit, billing, membership, or unrestricted all-account access. Set an explicit expiration and record only the rotation date, never the token.

- [ ] **Step 2: Capture Cloudflare identifiers without exposing them**

Read the current Account ID from Cloudflare. Keep the one-time API token and Account ID only in browser-session memory until both GitHub secrets are saved.

- [ ] **Step 3: Create the Vercel deployment token**

In Vercel, create a token named `quick-tools-github-actions`, scoped to the account/team that owns the existing `quick-tools` project, with an explicit expiration. Read the project's Organization ID and Project ID from project settings.

- [ ] **Step 4: Save five GitHub Actions Secrets**

In `PanWesley/quick-tools` repository settings, create:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

Use each value only in its matching secret. Do not create Actions variables containing these values.

- [ ] **Step 5: Verify names and discard plaintext**

Confirm GitHub lists all five secret names. Confirm the browser no longer displays either one-time token. Clear any clipboard text used for the transfer. If any site presents password, passkey, OTP, CAPTCHA, or account-level approval, stop and ask the user to complete it before continuing.

---

### Task 4: Document Operations And Publish The PR Update

**Files:**
- Modify: `workers/README.md`

**Interfaces:**
- Consumes: the two workflow job names and five secret names.
- Produces: operator documentation and a pushed PR branch ready for merge.

- [ ] **Step 1: Document the automated release**

Add an `自动生产部署` section stating:

```text
- pushes to main and manual dispatch invoke Deploy production;
- deploy-notifications must finish before deploy-vercel;
- Vercel direct Git production deployment for main is disabled in vercel.json;
- PR previews remain enabled;
- GitHub stores only the five deployment secrets;
- VAPID secrets remain in Cloudflare;
- credential expiration dates require rotation before expiry;
- no D1 migration is part of routine deployment.
```

Include GitHub Actions failure diagnosis and the independent Wrangler/Vercel rollback commands already established by the repository.

- [ ] **Step 2: Run final secret and workflow scan**

Run:

```bash
git diff --check
rg -n "CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|VERCEL_TOKEN|VERCEL_ORG_ID|VERCEL_PROJECT_ID" .github scripts workers/README.md
git grep -n "VAPID_PRIVATE_KEY=" || true
```

Expected: only secret references/names appear; no assignments or plaintext values are present.

- [ ] **Step 3: Commit documentation**

```bash
git add workers/README.md
git commit -m "docs: explain ordered production releases"
```

- [ ] **Step 4: Push the branch and verify PR #15**

```bash
git push origin codex/time-notification-delivery-clarity
gh pr view 15 --json url,isDraft,headRefName,baseRefName,statusCheckRollup
```

Expected: PR #15 targets `main`, includes the workflow commits, and retains successful preview checks. Keep the PR as draft until the user chooses to merge.

---

### Task 5: Observe The First Ordered Production Release

**Files:**
- No repository files unless verification reveals a defect.

**Interfaces:**
- Consumes: merged PR #15 and configured secrets.
- Produces: verified Cloudflare-first production deployment.

- [ ] **Step 1: Merge only with user authorization**

Do not merge PR #15 automatically. After the user merges it, open the `Deploy production` run for the merge commit.

- [ ] **Step 2: Verify job ordering**

Confirm `deploy-notifications` completes successfully before `deploy-vercel` starts. Confirm the workflow uses the merge commit SHA for both jobs.

- [ ] **Step 3: Verify production endpoints**

Run:

```bash
curl -fsS https://billnest.top/api/notifications/config
curl -fsS https://www.billnest.top/api/notifications/config
```

Confirm both return 200 with protocol configuration only. Verify Cloudflare lists the new Worker deployment and Vercel lists the matching production deployment.

- [ ] **Step 4: Verify the PWA rollout**

Open `https://billnest.top/tools/time/`, confirm the v32 Service Worker assets load, then perform the existing iOS background notification test. Do not claim end-to-end success until the real device receives the descriptive background notification and opening the PWA does not duplicate it.
