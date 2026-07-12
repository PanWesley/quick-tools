# Task 9 Report: Documentation and Automated Verification

Date: 2026-07-12

## Scope

- Updated user, changelog, Worker handoff, and backend design documentation.
- Performed only read-only Cloudflare readiness checks.
- Did not modify business code, create Cloudflare resources, apply remote migrations, write secrets, deploy, or run production/physical-device tests.
- Left `workers/notifications/wrangler.jsonc` unchanged because it contains no real account-specific D1 configuration to preserve or update.

## Documentation Evidence

The documentation now states:

- `device_id` identifies a browser/PWA installation, not hardware; clearing site data or reinstalling changes it, and nullable `user_id` can bind it later.
- Notification title/body/tag/target use application-layer AES-GCM end-to-end encryption; the key exists only in IndexedDB, while the backend still sees scheduling metadata and PushSubscription material.
- Notifications D1 plus a one-minute Cron provides background scheduling; reminders more than 15 minutes stale expire without a system banner.
- Local CRUD succeeds independently of notification backend failures, with pending/unsupported/error UI and retry behavior.
- Background sync requires native Web Locks and the documented PWA/browser capabilities.
- Notifications Worker/D1 and Analytics Worker/D1 remain isolated; only stateless foundations may be shared, never business databases or secrets.
- D1 creation, remote migration, VAPID secrets, routes, Cron, deploy, post-deploy verification, and rollback are controller-owned steps with explicit commands.
- A Service Worker cannot schedule itself merely because local time has arrived; a server Web Push event must wake it when the PWA is backgrounded or closed.
- Local implementation and automated verification are distinct from unverified production Cloudflare and physical-device behavior.

## Fresh Automated Verification

Runtime:

```text
NODE=/Users/wesley/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
PNPM=/Users/wesley/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
```

### Time tool tests

Executed the exact ten-file `NODE --test` command from the brief.

```text
tests 112
pass 112
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

### Syntax checks

The first loop wrapper was discarded because shell escaping passed literal `$f` to Node and therefore was not valid evidence. Each brief-listed file was then checked with a separate direct `NODE --check <file>` invocation:

```text
tools/time/js/date-utils.js              exit 0
tools/time/js/app-state.js               exit 0
tools/time/js/db.js                      exit 0
tools/time/js/notification-crypto.js     exit 0
tools/time/js/notification-model.js      exit 0
tools/time/js/notification-sync.js       exit 0
tools/time/js/notification.js            exit 0
tools/time/js/app.js                     exit 0
tools/time/sw.js                         exit 0
```

### Notifications Worker

From `workers/notifications`, with the bundled Node directory on `PATH`:

```text
PNPM test
tests 36
pass 36
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

With uppercase and lowercase proxy variables removed:

```text
PNPM check
wrangler deploy --dry-run
Total Upload: 57.98 KiB / gzip: 13.80 KiB
--dry-run: exiting now.
exit 0
```

The dry-run listed only `ALLOWED_ORIGINS`; it did not list a D1 binding.

## Read-Only Cloudflare Inventory

Command: bundled-Node `PNPM exec wrangler whoami` from `workers/notifications`.

1. With inherited proxy variables, Wrangler exited 1 during client initialization with:

   ```text
   InvalidArgumentError: Invalid URL protocol: the URL must start with `http:` or `https:`.
   ```

   Classification: local proxy environment error, before Cloudflare authentication. No token was printed.

2. Retried after unsetting uppercase and lowercase HTTP/HTTPS/ALL proxy variables. Wrangler returned:

   ```text
   You are not authenticated. Please run `wrangler login`.
   ```

   Classification: Cloudflare authentication is unavailable in this environment. No account identity or token was exposed.

Static `wrangler.jsonc` readiness:

- Present: Worker name/main, compatibility date, `nodejs_compat`, production allowed origins, and every-minute Cron `* * * * *`.
- Missing: `d1_databases` entry binding `NOTIFICATIONS_DB` to a real Notifications D1 UUID.
- Missing: routes for `billnest.top/api/notifications*` and `www.billnest.top/api/notifications*`.
- Needs correction before deployment: duplicate `compatibility_flags` key.
- Not inspectable while unauthenticated: remote D1 existence/migrations, Worker secrets, deployed routes/Cron, deployments, logs, and production config endpoint.

No config edit was made: there was no real D1 ID to update, and IDs must not be invented.

## Outstanding

- Authenticate the intended Cloudflare account and confirm account ownership.
- Create the isolated Notifications D1 with Wrangler `--update-config`, review the real UUID, and remove the duplicate config key.
- Add both production routes while retaining the one-minute Cron.
- Apply the remote migration and set the three VAPID secrets.
- Deploy only after controller review, then verify config, Cron execution, stale expiration, encrypted network payloads, logs, metrics, and rollback behavior.
- Run fresh-browser integration for permission, device ID persistence, encrypted test push, API-failure CRUD, queue recovery, and click targeting.
- Run real background/closed-PWA delivery on iOS/iPadOS Home Screen, Android Chromium PWA, and desktop Chromium. Production background delivery is not verified.

## Files

- `tools/time/README.md`
- `tools/time/CHANGELOG.md`
- `workers/README.md`
- `docs/superpowers/specs/2026-07-11-time-web-push-backend-design.md`
- `.superpowers/sdd/task-9-report.md`
