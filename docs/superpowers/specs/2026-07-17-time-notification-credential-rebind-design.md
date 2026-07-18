# Time Notification Credential Rebind Design

## Problem

The Time PWA can remain permanently at `需要重新授权` after its stored device
credential is rejected. iOS notification permission is still granted and the
production Worker, D1 database, Cron trigger, VAPID configuration, and Web Push
delivery are healthy.

The client currently handles an authenticated `401` or `403` by marking the
installation with `authenticationReset`. The next enable attempt first calls
`PushSubscription.unsubscribe()`. A false result or rejection prevents device
registration, so an iOS installation can never leave the error state even
though its existing PushSubscription is usable.

The UI also maps permission denial, authentication reset, subscription failure,
and terminal synchronization errors to the same `error` status and copy. This
makes the failure impossible to diagnose from the PWA.

## Goals

- Recover a rejected device credential without deleting the PWA or local data.
- Reuse an existing valid PushSubscription without requiring `unsubscribe()`.
- Preserve the local notification AES key and all task, habit, journal, and
  reminder data.
- Keep recovery bounded and safe to retry on foreground and explicit user
  action.
- Distinguish system permission, credential, network, and subscription states
  with concise status copy.
- Avoid duplicate active subscriptions and duplicate reminder delivery.

## Non-Goals

- No D1 schema migration.
- No VAPID key rotation.
- No change to reminder encryption or notification payload copy.
- No account/user binding work.
- No destructive PWA reinstall or site-data reset flow.

## Selected Approach

Use a soft device credential rebind.

When an authenticated request returns `401` or `403`, the client removes the
invalid device token and queued requests scoped to that device, but retains the
browser PushSubscription and local cryptographic material. The installation is
persisted as `reauthorization-required`.

The next bounded recovery attempt performs these steps:

1. Fetch notification configuration.
2. Register a fresh backend device and persist its new credential.
3. Read the existing PushSubscription with `getSubscription()`.
4. Reuse it when present and valid; create a new subscription only when none
   exists or it is expired and the recovery was started by an explicit user
   action.
5. Upload the subscription under the new device credential.
6. Project and synchronize the current reminder snapshot.
7. Publish `ready` only after subscription upload and synchronization succeed.

The server repository already handles endpoint ownership transfer atomically:
uploading an endpoint for a new device invalidates the previous device's active
subscription and cancels that device's deliverable reminders before activating
the new owner. The rebind therefore does not require a client-side unsubscribe
and does not create two active owners for one endpoint.

## Client State Model

Add an explicit public `reauthorization-required` status instead of using the
generic `error` status for rejected credentials.

- `permission-required`: browser permission is `default`.
- `permission-denied`: browser permission is `denied`; the user must use iOS
  Settings.
- `reauthorization-required`: the backend rejected stored device credentials.
- `subscribing` / `syncing`: a bounded repair or normal enable is in progress.
- `pending`: network or retryable backend work is queued.
- `ready`: the subscription and current reminder projection are synchronized.
- `error`: a non-authentication subscription or terminal synchronization error.
- `unsupported`: required browser capabilities are unavailable.
- `disabled`: notifications are intentionally off.

Approved visible copy:

| State | Label/description | Primary action |
| --- | --- | --- |
| `permission-required` | `未开启通知` | `开启通知` |
| `permission-denied` | `请在系统设置中开启通知` | `查看说明` |
| `reauthorization-required` | `提醒连接已失效` | `重新连接` |
| `subscribing`, `syncing` | `正在重新连接` when repairing, otherwise `正在连接` | disabled |
| `pending` | `等待网络恢复` | `重试` |
| `ready` | `后台提醒已开启` | `测试提醒` |
| `error` | `提醒连接失败` | `重试` |

The compact status area remains one line. It must not claim that iOS permission
is missing when permission is already granted.

`查看说明` displays the short path `iPhone 设置 > App > 今日有序 > 通知` in
the PWA. It does not depend on an unsupported or unreliable Settings deep link.

## Recovery Triggers And Bounds

- On foreground/startup, attempt one soft rebind when the persisted state is
  `reauthorization-required`, the page is visible, permission is granted, and
  the browser is online. Automatic recovery may reuse an existing valid
  PushSubscription but must not create a missing subscription without a user
  gesture.
- If automatic recovery finds no valid subscription, keep
  `reauthorization-required` and wait for the explicit `重新连接` action.
- The existing lifecycle owner and Web Lock continue to prevent overlapping
  setup, sync, disable, and recovery operations.
- Do not loop immediately after a failed attempt. Retry through the existing
  bounded queue/backoff behavior, a later foreground/online event, or the
  explicit `重新连接` action.
- An explicit user action may force one eligible retry but cannot create a
  second concurrent recovery.
- Page hide/unload invalidates UI publication from stale work as it does today.

## Error Handling

- A repeated `401` or `403` from the new device credential returns to
  `reauthorization-required` and stops the current attempt.
- Network failures preserve the new credential and subscription intent as
  `pending`; they do not discard local data or request permission again.
- `getSubscription()` failure reports `error` and remains manually retryable.
- An expired subscription may be unsubscribed as normal. Failure to retire an
  expired subscription reports `error`, but this is separate from credential
  rebind and does not erase task data.
- Permission `denied` never calls `Notification.requestPermission()` in a loop;
  the UI directs the user to iOS Settings.
- Disable/cleanup semantics remain unchanged and continue to remove the server
  subscription before local browser cleanup where possible.

## Data And Privacy

- No device token, endpoint, PushSubscription keys, reminder plaintext, or AES
  key is logged or exposed in UI diagnostics.
- The fresh backend device ID remains an installation identifier, not a hardware
  identifier.
- Queued operations addressed to the rejected device are deleted before the
  new device is synchronized, preventing cross-device request replay.
- The existing encrypted reminder projection is rebuilt from local source data
  for the new device scope.

## Test Strategy

### Notification sync unit tests

- A test push `401` changes status to `reauthorization-required`.
- A later recovery registers a new device and reuses the existing subscription.
- Rebind succeeds even when the old subscription's `unsubscribe()` always
  returns false or rejects.
- Rebind does not call `subscribe()` when a valid subscription already exists.
- The old device queue is removed and new reminder IDs use the new device scope.
- Concurrent foreground and explicit retries perform one registration/upload.
- Repeated rejection remains bounded and does not loop.
- Network failure after registration remains `pending` and resumes successfully.
- Permission denial maps to `permission-denied`, not an authentication status.

### Integration tests

- UI copy and action labels match each public status.
- Foreground recovery publishes `ready` only after rebind and sync complete.
- Existing local task scheduling still runs even when backend recovery fails.
- Disable and normal first-time enable behavior do not regress.

### Existing suites

- Run all Time tests.
- Run all Notifications Worker tests even though no Worker change is expected.
- Run the production deployment contract tests and Wrangler dry-run before
  publishing the branch.

### Production verification

- Merge only after CI passes.
- Confirm the ordered Worker-before-Vercel production workflow succeeds.
- On the affected iPhone, open the PWA with system permission still enabled and
  verify it automatically reaches `后台提醒已开启` or succeeds after one
  `重新连接` tap.
- Send a test notification, then schedule a background reminder and verify no
  stale foreground duplicate appears when the PWA is opened later.

## Rollback

The change is client-only. Revert the PWA deployment if recovery causes a
regression; no Worker, D1, or VAPID rollback is required. Existing server
devices and subscriptions remain valid throughout rollback.
