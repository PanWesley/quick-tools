# Production Deployment Orchestration Design

## Goal

Make GitHub Actions the only production release controller for `main`. Every production release must deploy and verify the Notifications Worker before it deploys the Vercel PWA. A Worker failure must leave the currently deployed PWA unchanged.

## Current State

- GitHub is the source repository and `main` is the production branch.
- Vercel currently starts a production deployment directly from Git pushes.
- `workers/notifications/` is deployed separately with Wrangler.
- The repository has no `.github/workflows/` configuration.
- Cloudflare already has the production Worker name, D1 binding, Cron trigger, routes, and VAPID secrets.
- This change does not create or migrate D1 and does not rotate VAPID keys.

## Selected Approach

Add one production workflow and disable only Vercel's automatic Git deployment for `main` through `vercel.json`. Keep Git integration enabled for pull-request previews.

The workflow runs on pushes to `main` and on manual `workflow_dispatch`:

1. Check out the exact `main` commit.
2. Install the pinned Notifications Worker dependencies.
3. Run all Notifications Worker tests.
4. Run a Wrangler dry-run.
5. Deploy the Notifications Worker to Cloudflare.
6. Only after the Worker job succeeds, build and deploy the same commit to Vercel production.
7. Record both deployment results in the GitHub Actions run.

GitHub Actions concurrency is limited to one production deployment at a time. A newer commit waits for the active production release rather than cancelling a deployment halfway through.

## Workflow Boundaries

### Cloudflare Job

Working directory: `workers/notifications/`.

The job uses the repository's pinned Wrangler dependency and lockfile. It receives these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token is scoped to the current Cloudflare account and `billnest.top`. It must be able to deploy the Worker and manage the configured Worker routes, but it must not grant DNS edit, billing, user-management, or global-account access. D1 migration commands are deliberately excluded from the workflow.

### Vercel Job

The Vercel job has `needs: deploy-notifications`, so it cannot start if Worker tests, dry-run, or deployment fail. It receives:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

It uses a reviewed, pinned Vercel CLI version to pull production settings, build the checked-out commit, and deploy the prebuilt output with `--prod`. The workflow never prints tokens or writes them into repository files.

### Vercel Git Behavior

`vercel.json` will set Git deployment for `main` to disabled while leaving other branches enabled. This keeps PR preview deployments but prevents Vercel from starting production before the Worker job completes. CLI production deployments from GitHub Actions remain enabled.

## Secret Creation And Storage

The Cloudflare and Vercel dashboards are used only to create scoped deployment credentials and read non-secret account/project identifiers. Values are transferred directly into GitHub Actions Secrets and are never committed, echoed, pasted into chat, or saved in a local file.

Repository Actions secrets are used because the repository currently has a single production environment and no existing GitHub Environment protection model. Secret names are fixed to the five names listed above.

Existing Worker runtime secrets remain in Cloudflare:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

They are not copied to GitHub because GitHub deploys code while Cloudflare retains runtime secrets across Worker deployments.

## Browser Automation

Chrome automation may:

- create the scoped Cloudflare API token;
- read the Cloudflare Account ID;
- create a scoped Vercel deployment token;
- read the Vercel organization and project IDs;
- create or update the five GitHub Actions Secrets;
- verify the resulting dashboard settings without exposing secret values.

If Cloudflare, GitHub, or Vercel requests a password, passkey, OTP, CAPTCHA, or account-level confirmation, automation stops on that page and hands control to the user. It resumes after the user completes the challenge.

## Failure Handling

- Test or dry-run failure: neither platform is deployed.
- Cloudflare deployment failure: Vercel job is skipped.
- Vercel deployment failure after Worker success: the new Worker remains backward compatible with the old PWA, and the existing Vercel production deployment remains active.
- Concurrent releases: serialized by the workflow concurrency group.
- Secret absence: the workflow fails before production deployment and identifies only the missing secret name.

Worker rollback remains independent from PWA rollback. Wrangler rollback restores a previous Worker version without deleting D1 or VAPID secrets. Vercel rollback restores a previous production deployment without changing the Worker.

## Verification

Before enabling production automation:

- parse and lint the workflow YAML;
- run the Notifications Worker test suite locally;
- run Wrangler dry-run locally;
- verify that `vercel.json` remains valid JSON;
- verify that no credential value appears in Git history or workflow logs.

After secrets are configured:

1. Push the workflow update to PR #15 and retain PR previews.
2. Confirm GitHub recognizes the workflow syntax.
3. Merge only after the Cloudflare and Vercel dashboard configuration is complete.
4. Observe the first `main` run and confirm the Worker job finishes before the Vercel job starts.
5. Verify `/api/notifications/config`, the Cloudflare deployment list, the Vercel production deployment, and the Time PWA asset versions.

## Success Criteria

- A single GitHub Actions run controls each production release.
- Vercel production never starts before a successful Notifications Worker deployment.
- PR preview deployments continue to work.
- A failed Worker release cannot publish a new PWA.
- No deployment token or VAPID secret is present in the repository, local files, chat, or logs.
- The local computer may be turned off after configuration; GitHub, Cloudflare, and Vercel run the release independently.
