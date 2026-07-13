# Task 9 Report: Documentation and Automated Verification

Date: 2026-07-12

## Scope

- Updated user, changelog, Worker handoff, and backend design documentation.
- Performed only read-only Cloudflare readiness checks.
- Did not modify business code, create Cloudflare resources, apply remote migrations, write secrets, deploy, or run production/physical-device tests.
- Removed the duplicate `compatibility_flags` key from `workers/notifications/wrangler.jsonc` without inventing an account-specific D1 ID.

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
- Corrected locally: duplicate `compatibility_flags` key removed.
- Not inspectable while unauthenticated: remote D1 existence/migrations, Worker secrets, deployed routes/Cron, deployments, logs, and production config endpoint.

No account-specific D1 binding or route edit was made: there was no real D1 ID to update, and IDs must not be invented.

## Outstanding

- Authenticate the intended Cloudflare account and confirm account ownership.
- Create the isolated Notifications D1 with Wrangler `--update-config` and review the real UUID.
- Add both production routes while retaining the one-minute Cron.
- Apply the remote migration and set the three VAPID secrets.
- Deploy only after controller review, then verify config, Cron execution, stale expiration, encrypted network payloads, logs, metrics, and rollback behavior.
- Run real background/closed-PWA delivery on iOS/iPadOS Home Screen, Android Chromium PWA, and desktop Chromium. Production background delivery is not verified.

## Local Chromium Integration

Validated against `http://127.0.0.1:4173/tools/time/` with the system Google Chrome controlled through Playwright:

- Desktop 1440x900 and mobile 390x844 layouts loaded without page exceptions or horizontal overflow; notification status and controls remained readable.
- The page became controlled by the registered Service Worker and `navigator.serviceWorker.ready` resolved.
- Before user interaction, permission remained `default`, the UI showed `未开启`, and the instrumented `Notification.requestPermission` call count was zero. One click made exactly one request; a denied result displayed `需要重新授权`.
- With a deterministic mocked notification API and PushManager, the user-click flow reached `后台提醒已开启`, uploaded the PushSubscription with a bearer token, reconciled, and sent an encrypted backend test.
- The anonymous installation kept the same `device_id` across a full page reload without another device registration request. Clearing all origin storage and enabling again issued one new registration and returned a different `device_id`, matching the documented installation boundary.
- The backend test request contained only `{ v, iv, ciphertext }`; no test title/body appeared in network request plaintext.
- While all notification API requests were aborted, creating a task still closed the form, showed `事项已创建`, retained the task locally, and displayed `等待同步`. Dispatching `online` after restoring the API returned the UI to `后台提醒已开启`.
- A future task reminder PUT contained only a hashed source ID, absolute time, revision, and AES-GCM envelope; its Chinese title did not appear in the request body.
- A real Chromium DevTools `ServiceWorker.deliverPushMessage` event decrypted and displayed the expected notification. Re-delivering the same tag kept one visible notification; malformed ciphertext displayed `你有一项提醒 / 打开今日有序查看详情`.
- A notification-click message for a future task switched to the calendar view, selected the correct date, and applied the visible non-layout-shifting highlight to the active entity.
- Terminating a real dedicated Worker while it held the notification lifecycle Web Lock released the lock; the page acquired the same lock within 1.5 seconds.

The local Chromium run used mocked API responses and a mocked PushManager for registration because no authenticated notification Worker or production push service was available. It verifies client lifecycle, encryption boundaries, Service Worker push handling, and recovery, but does not claim production delivery.

## Files

- `tools/time/README.md`
- `tools/time/CHANGELOG.md`
- `workers/README.md`
- `docs/superpowers/specs/2026-07-11-time-web-push-backend-design.md`
- `.superpowers/sdd/task-9-report.md`
