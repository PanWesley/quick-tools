# Time Notification Credential Rebind Implementation Plan

> **For Codex:** REQUIRED SKILL: Use `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Recover an iOS PWA whose backend notification credential was rejected by rebinding its existing PushSubscription to a fresh device credential, while presenting accurate, actionable notification states.

**Architecture:** Keep the existing IndexedDB installation record, Web Lock serialization, encrypted reminder projection, and Worker API. Replace destructive authentication recovery with a bounded soft rebind: clear only rejected backend credentials and their queued requests, register a new backend device, reuse the current PushSubscription, upload it to the new owner, and synchronize reminders before publishing `ready`. Add explicit permission and reauthorization states in the UI and publish new PWA asset versions so installed clients receive the fix.

**Tech Stack:** Browser JavaScript, Service Worker, IndexedDB, Push API, Notifications API, Node.js `node:test`, Cloudflare Worker tests.

## Constraints

- Do not change Notifications Worker routes, D1 schema, VAPID keys, encryption formats, or local task data.
- Do not require `PushSubscription.unsubscribe()` during credential recovery.
- Automatic foreground recovery may reuse an existing subscription but may not call `subscribe()` without a user gesture.
- Explicit `重新连接` may create a missing subscription after permission is already granted.
- Preserve the current lifecycle owner and Web Lock as the sole concurrency boundary.
- Keep failed recovery bounded; do not introduce immediate retry loops.

### Task 1: Implement Soft Credential Rebind

**Files:**
- Modify: `tools/time/js/notification-sync.test.js`
- Modify: `tools/time/js/notification-sync.js`

**Step 1: Replace the destructive-authentication regression tests**

Update the existing authentication-reset tests to assert:

- An authenticated `401` or `403` publishes `reauthorization-required` and removes the rejected token.
- The next explicit recovery registers exactly one new device and uploads the existing endpoint.
- Recovery never calls the existing subscription's `unsubscribe()` and never calls `subscribe()` when `getSubscription()` returns a valid subscription.
- Recovery still succeeds if the old subscription's `unsubscribe()` would return `false` or reject.
- Queued requests scoped to the rejected device are removed.
- A repeated rejection remains `reauthorization-required` without recursive registration.

Add tests for the two recovery modes:

- `handleForeground()` reuses an existing subscription.
- `handleForeground()` leaves `reauthorization-required` when no subscription exists, while explicit `enable()` may create one.

**Step 2: Run the focused tests and confirm failure**

Run:

```bash
node --test --test-name-pattern="authentication|reauthorization|foreground" tools/time/js/notification-sync.test.js
```

Expected: FAIL because authentication reset currently maps to `error` and requires unsubscribe before registering a replacement device.

**Step 3: Implement the state transition and bounded recovery**

In `notification-sync.js`:

- Map persisted `authenticationReset` to public `reauthorization-required`.
- Keep `applyAuthenticationReset()` responsible for clearing the rejected token and old-device queue, but retain the browser subscription and cryptographic installation data.
- Remove `retireAuthenticationSubscription()` from the authentication-recovery path.
- Give `enableImpl` an explicit option such as `allowSubscribe`/`userInitiated` so lifecycle recovery can reuse but cannot create a missing subscription.
- Register a fresh device before binding the current endpoint.
- If no subscription exists during automatic recovery, persist the repair state and return `reauthorization-required`.
- If explicit recovery has permission and no subscription, call `subscribe()` once and continue normally.
- Preserve pending behavior for retryable network errors and stop immediately on a repeated `401`/`403`.

**Step 4: Run the focused and complete sync tests**

Run:

```bash
node --test --test-name-pattern="authentication|reauthorization|foreground" tools/time/js/notification-sync.test.js
node --test tools/time/js/notification-sync.test.js
node --check tools/time/js/notification-sync.js
```

Expected: PASS.

**Step 5: Commit the state-machine change**

```bash
git add tools/time/js/notification-sync.js tools/time/js/notification-sync.test.js
git commit -m "fix(time): rebind rejected notification credentials"
```

### Task 2: Expose Accurate UI States And Actions

**Files:**
- Modify: `tools/time/js/notification-integration.test.js`
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/css/style.css` only if the new typed states need an existing status-color alias

**Step 1: Add failing UI contract tests**

Update integration tests to require the approved labels and actions:

- `permission-required`: `未开启通知`, action `开启通知`
- `permission-denied`: `请在系统设置中开启通知`, action `查看说明`
- `reauthorization-required`: `提醒连接已失效`, action `重新连接`
- repair in progress: `正在重新连接`
- normal setup in progress: `正在连接`
- `pending`: `等待网络恢复`, action `重试`
- `ready`: `后台提醒已开启`, action `测试提醒`
- `error`: `提醒连接失败`, action `重试`

Add behavior assertions that:

- `permission-denied` does not call `Notification.requestPermission()` again.
- `查看说明` displays `iPhone 设置 > App > 今日有序 > 通知`.
- `重新连接` calls the explicit recovery path.
- Foreground recovery may move reauthorization state to ready, but does not overlap an in-flight action.

**Step 2: Run the integration tests and confirm failure**

Run:

```bash
node --test --test-name-pattern="status copy|permission|reconnect|foreground recovery" tools/time/js/notification-integration.test.js
```

Expected: FAIL because denied permission and rejected credentials currently collapse into generic `error`/`需要重新授权`.

**Step 3: Implement typed rendering and actions**

In `app.js`:

- Extend `NOTIFICATION_STATUS_COPY` with `permission-denied` and `reauthorization-required`.
- Preserve repair context so `subscribing`/`syncing` can display `正在重新连接` during a rebind.
- Map `Notification.permission === 'denied'` to `permission-denied`, not `error`.
- Derive the primary action label from the typed state instead of grouping permission and backend errors.
- On `查看说明`, show the approved iPhone Settings path without attempting a deep link or requesting permission.
- On `重新连接`, invoke explicit `NotificationSync.enable()` once.
- Keep test notification behavior and normal first-time authorization unchanged.

Use existing status styles for semantic aliases unless a new selector is required; do not redesign the settings panel.

**Step 4: Run focused and full integration tests**

Run:

```bash
node --test --test-name-pattern="status copy|permission|reconnect|foreground recovery" tools/time/js/notification-integration.test.js
node --test tools/time/js/notification-integration.test.js
node --check tools/time/js/app.js
```

Expected: PASS.

**Step 5: Commit the UI change**

```bash
git add tools/time/js/app.js tools/time/js/notification-integration.test.js tools/time/css/style.css
git commit -m "fix(time): clarify notification recovery states"
```

Only add `style.css` if it changed.

### Task 3: Publish Fresh PWA Assets And Document Recovery

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/sw.js`
- Modify: `tools/time/js/service-worker-notification.test.js`
- Modify: `tools/time/README.md`
- Modify: `tools/time/CHANGELOG.md`

**Step 1: Add failing cache-version assertions**

Update Service Worker tests to require:

- `notification-sync.js?v=5`
- `app.js?v=139`
- app shell cache `today-youxu-v33`
- activation keeps `v33` and deletes `v32` while preserving the notification receipt cache

Run:

```bash
node --test tools/time/js/service-worker-notification.test.js
```

Expected: FAIL until the index and Service Worker asset versions are updated together.

**Step 2: Update the app shell and documentation**

- Change matching asset URLs in both `index.html` and `sw.js`.
- Bump `CACHE_NAME` to `today-youxu-v33`.
- Update README notification-state wording so it no longer says all recovery failures require authorization.
- Add an Unreleased changelog fix describing automatic credential rebind and the new typed states.
- Update the changelog deployment note from PWA v32 to v33.

**Step 3: Run cache and static checks**

Run:

```bash
node --test tools/time/js/service-worker-notification.test.js
node --check tools/time/sw.js
git diff --check
```

Expected: PASS.

**Step 4: Commit the release-contract change**

```bash
git add tools/time/index.html tools/time/sw.js tools/time/js/service-worker-notification.test.js tools/time/README.md tools/time/CHANGELOG.md
git commit -m "chore(time): publish notification recovery assets"
```

### Task 4: Full Verification And Review

**Files:**
- Verify only; modify the preceding files only for defects found by tests or review.

**Step 1: Run all Time tests and syntax checks**

```bash
node --test tools/time/js/*.test.js
node --check tools/time/js/notification-sync.js
node --check tools/time/js/app.js
node --check tools/time/sw.js
```

Expected: PASS with zero failed tests.

**Step 2: Run Notifications Worker regression checks**

```bash
cd workers/notifications
pnpm test
pnpm check
pnpm exec wrangler deploy --dry-run
```

Expected: PASS. No Worker source or deployment configuration should change.

**Step 3: Review scope and invariants**

Inspect the final diff and confirm:

- No call to unsubscribe is required by the authentication-rebind path.
- Automatic lifecycle recovery cannot create a missing PushSubscription.
- Explicit recovery remains serialized by the existing lock.
- No plaintext reminder data, device token, endpoint, or encryption key is logged.
- No unrelated repository files changed.

Run:

```bash
git diff --check
git status --short
git diff main...HEAD -- tools/time
```

**Step 4: Perform local browser smoke test**

Serve the repository on a fresh local port, open `/tools/time/`, and verify the settings row has no layout overflow at mobile width. Browser automation cannot fully reproduce iOS Web Push credential rejection, so the state-machine behavior remains covered by deterministic tests and final delivery must be verified on the affected iPhone after deployment.

**Step 5: Commit any verification-only corrections**

If review requires changes, add a narrowly scoped correction commit and rerun every affected test. Otherwise leave the verified commits unchanged.

## Production Acceptance

After CI and deployment complete:

1. Open the installed iPhone PWA while notification permission remains enabled.
2. Confirm the row changes from `提醒连接已失效`/`正在重新连接` to `后台提醒已开启`; tap `重新连接` once only if automatic recovery cannot reuse a subscription.
3. Tap `测试提醒` and verify a clear notification title and body.
4. Schedule a reminder a few minutes ahead, close or background the PWA, and verify system delivery.
5. Reopen the PWA after delivery and confirm no stale foreground duplicate appears.

