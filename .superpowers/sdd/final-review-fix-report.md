# Final Review Blocker Fix Report

Date: 2026-07-13
Base HEAD: `b012d78`

## Scope And Contract Decisions

- Client projection remains a 30-local-calendar-day horizon. Worker reminder validation and reconcile use a `31 * 24h` envelope only for timezone and DST tolerance.
- Notifications JSON bodies are bounded at 128 KiB. Reconcile remains bounded at 500 summaries with 128-character IDs.
- Reminder transport IDs are `<deviceId>:<opaqueModelId>` and remain at most 128 characters. Model IDs and encrypted notification tags are not device-scoped.
- Bulk subscription disable preserves reminder revision and writes `last_error_code = 'subscription_disabled'`. Equal-revision upsert restores only that state. Explicit item cancellation and reconcile cancellation clear that marker and require a higher revision or authoritative omission respectively.
- Reconcile is authoritative: active server-only rows in its window are conditionally cancelled by device, ID, and observed revision before the response returns. `unknown` contains only IDs whose cancellation update succeeded.
- Web Push TTL is based on the original `notifyAt + 15 minutes` stale deadline, rounded up to seconds and clamped to `0..900`. Retry scheduling never changes `notifyAt`.
- Equal-version reminder queue replacement refreshes request content and generation but preserves attempts, terminal state, and next retry time. Only a higher revision resets retry state. Cleanup terminal recovery remains an explicit exception.
- The initial migration remains unchanged: its existing nullable `last_error_code TEXT` supports the bulk-disable marker, and device scoping is intentionally enforced by transport IDs rather than a schema rewrite.

## RED And GREEN Evidence

1. Authoritative reconcile cancellation
   - RED: Worker suite failed because HTTP and SQLite reminders remained `pending`; the race test returned `unknown: ['raced']` instead of preserving the newer revision.
   - GREEN: Real SQLite and HTTP tests now cover completed, deleted, and rescheduled omissions; all old reminders are cancelled before `claimDue`, while an intervening higher revision remains pending.

2. DST envelope
   - RED: the 721-hour New York fallback reminder failed Worker validation (`false !== true`) and HTTP PUT returned 400 instead of 201.
   - GREEN: core and HTTP tests accept the fallback boundary, reject values beyond 31 days, and confirm reconcile uses the 31-day server envelope. Existing client fallback and spring-forward tests still prove the 30-local-day horizon.

3. Capacity contract
   - RED: a 500-summary HTTP request returned 413 instead of 200; four daily habits produced 120 reminders but sync returned `error`; the queue stopped at 100 instead of 500.
   - GREEN: the 120 projected reminders plus reconcile queue successfully, queue storage remains bounded at 500 with terminal compaction, HTTP accepts 500 maximum-length summaries, and 501 returns `invalid_reconcile`.

4. First offline enable
   - RED: after config and device-registration failures the IndexedDB installation record was undefined, so online/foreground recovery could not resume.
   - GREEN: enable intent is persisted before config/device network calls; config and device failure tests both recover to ready through online/foreground lifecycle calls.

5. Disable, re-enable, and auth reset
   - RED: bulk disable left `last_error_code` null, the HTTP re-enable fixture retained `subscription_disabled` after restore, transport paths were unscoped, and the inline disable control/function was absent.
   - GREEN: real SQL and HTTP tests enforce bulk-only equal-revision restore; client tests cover enable -> sync -> disable -> enable -> sync and auth reset to a new device; path, summary, and logical key use the same device-scoped ID; ready UI keeps the test button and exposes inline disable with pending state.

6. Foreground and Push deduplication
   - RED: `NotificationModel.buildNotificationTag` was undefined and foreground notifications used a notify-time tag with `renotify = true`.
   - GREEN: model projection and foreground timer use the same due-time tag; the focused test compares the foreground notification with the encrypted push payload and verifies `renotify = false`.

7. TTL
   - RED: Cron messages had undefined TTL and `sendWebPush(... ttlSeconds: 1)` still built TTL 900.
   - GREEN: Cron retry tests pass TTL 1 near the stale boundary on repeated attempts; sender tests cover default 900, explicit TTL, and invalid values outside integer `0..900`.

8. Retry preservation
   - RED: equal-revision sync plus immediate online/foreground produced 4 attempts instead of 1; full recovery followed by sync produced 21 attempts instead of the five-attempt bound.
   - GREEN: equal revision preserves attempts, terminal state, and next retry time while updating ciphertext; immediate lifecycle calls do not bypass backoff; higher revision resets; repeated full recovery remains terminal at five attempts.

9. Missing future entity fallback
   - RED: the click handler only contained `if (!entity) return`.
   - GREEN: a missing future calendar entity switches to Today and renders again before returning.

10. Capability-first unsupported state
    - RED: setup without Push API returned `disabled` instead of `unsupported`.
    - GREEN: setup/getStatus short-circuit on missing PushManager, Notification, or Web Locks before disabled or permission state; the no-Push test confirms Notification permission is not read.

Support RED/GREEN: after page asset versions were bumped, the service-worker cache test failed on stale `v=136`/cache `v29`; it passes with cache `v30` and exact updated app-shell URLs.

## Current Automated Counts

- Time tool: 124 tests, 124 pass, 0 fail.
- Notifications Worker: 46 tests, 46 pass, 0 fail.
- Focused client lifecycle/model/UI suite: 81 tests, 81 pass, 0 fail.
- No cloud resources, account-specific configuration, remote migrations, secrets, or deployments were created or changed.

## Final Verification

Fresh verification immediately before commit used:

```text
NODE=/Users/wesley/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
PNPM=/Users/wesley/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
```

- `$NODE --test tools/time/js/*.test.js`: 124 tests, 124 pass, 0 fail, exit 0.
- `cd workers/notifications && PATH=<bundled-node>:$PATH $PNPM test`: 46 tests, 46 pass, 0 fail, exit 0.
- Individual `$NODE --check` for every changed JS/MJS file: 17 checked, 17 exit 0.
- Proxy-cleared `$PNPM check`: Wrangler `deploy --dry-run`, upload 59.42 KiB / gzip 14.13 KiB, exit 0.
- `git diff --check`: exit 0 with no output.

## Remaining Important Fixes

Base HEAD: `88c646e`

### RED Evidence

1. Bulk marker reconciliation and endpoint ownership
   - `node --test repository.test.mjs` failed 3 of 11 tests before the repository change.
   - Empty reconcile left `subscription_disabled` set, the observed-revision race hook was never reached, and a claimed endpoint left both device subscriptions active.

2. Browser subscription retirement and cleanup auth rejection
   - The focused notification-sync suite failed the new auth-reset and cleanup cases before the client change.
   - Ordinary auth reset registered `device-2` without unsubscribing the stale browser subscription. Cleanup DELETE 401/403 returned `error` without attempting local unsubscribe.
   - Stale unsubscribe `false` and rejection did not block new device registration because retirement was not part of enable recovery.

3. Reconcile retry preservation
   - The focused notification-sync suite made 11 reconcile requests instead of 1 across 10 immediate same-data recovery cycles.
   - Reordered but equivalent summaries made 2 requests instead of 1. A persisted legacy unsorted body reproduced the same reset in a dedicated RED run.

### GREEN Evidence

1. Repository
   - Reconcile clears only the bulk-disable marker for an omitted cancelled row matching device, ID, observed revision, status, marker, and authoritative time window. Status remains cancelled, equal-revision upsert is unchanged, and a concurrent higher revision wins.
   - Subscription upsert uses one D1 batch to cancel the previous endpoint owner's active reminders, invalidate its subscription, and upsert the new owner. The real SQLite test confirms `claimDue` returns only the new device.

2. Client auth and cleanup
   - Auth reset must complete local unsubscribe before device registration, persists a forced-new-subscription intent, and never reuses the stale PushSubscription. `false` and rejection remain typed `error` states and are retryable through explicit enable.
   - Cleanup DELETE 401/403 is treated as server-terminal but still performs local unsubscribe. Success persists disabled state without foreground auto-enable; failure remains cleanup-pending and retries only local unsubscribe.
   - Existing explicit terminal cleanup recovery still passes for `handleOnline`, `handleForeground`, and `disable`.

3. Reconcile retry
   - Reconcile summaries are persisted in stable order and compared semantically independent of persisted order.
   - Same content preserves attempts, terminal state, and `nextRetryAt` despite sync generation changes. New content resets once; immediate calls respect backoff; same-data recovery remains bounded at five requests.

### Fresh Verification

- `$NODE --test tools/time/js/notification-sync.test.js`: 56 tests, 56 pass, 0 fail, exit 0.
- `$NODE --test tools/time/js/*.test.js`: 130 tests, 130 pass, 0 fail, exit 0.
- `cd workers/notifications && PATH=<bundled-node>:$PATH $PNPM test`: 49 tests, 49 pass, 0 fail, exit 0.
- Proxy-cleared `$PNPM check`: Wrangler dry-run upload 60.73 KiB / gzip 14.29 KiB, exit 0.
- `$NODE --check` for all 4 changed JS/MJS files: 4 checked, 4 exit 0.
- `git diff --check`: exit 0 with no output.
