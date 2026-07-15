# Time Notification Delivery Clarity Design

**Date:** 2026-07-15
**Status:** Approved direction, pending written-spec review

## Context

Production background delivery now reaches an iOS 26.5 Home Screen PWA while the app is closed. A real reminder produced two notifications:

1. At the scheduled reminder time, the Service Worker showed the generic fallback: `你有一项提醒 / 打开今日有序查看详情`.
2. Nine minutes later, opening the app caused the foreground scheduler to show the clear reminder, even though its reminder time had passed.

The generic notification proves that Web Push delivery and Service Worker wake-up succeeded. In the current Service Worker, that copy is used only when push data is missing, envelope parsing fails, the local AES key cannot be read, decryption fails, or the decrypted payload fails validation. The current crypto store persists a non-extractable `CryptoKey` directly in IndexedDB and expects the background Service Worker to deserialize the same object. WebKit has had CryptoKey structured-clone issues in Service Workers, and iOS 26 still has reported IndexedDB interactions specific to installed PWAs after Push subscription:

- https://bugs.webkit.org/show_bug.cgi?id=183167
- https://bugs.webkit.org/show_bug.cgi?id=315804

The duplicate is independently explained by current application code. The Service Worker does not update the page's `localStorage` notification log. On app resume, `scheduleOne()` treats a missed reminder as eligible while its task is still upcoming, schedules it two seconds later, and builds copy from the original reminder offset. This produces a late banner such as `还有 15 分钟` even when fewer than 15 minutes remain.

## Goals

- Show the actual reminder title and concise context for background notifications on supported PWAs.
- Preserve application-layer encryption: the Worker and D1 must not receive plaintext reminder titles or bodies.
- Prevent a reminder already displayed by Web Push from being displayed again by the foreground scheduler.
- Never show a foreground system banner long after its intended reminder time.
- Migrate existing installations without requiring users to clear site data, reinstall the PWA, or manually toggle reminders.
- Keep local task and habit CRUD independent from notification backend failures.

## Non-Goals

- Do not add accounts or cross-device reminder synchronization.
- Do not merge Notifications D1 with Analytics D1.
- Do not send plaintext fallback notification content to the Worker.
- Do not depend on Apple Declarative Web Push; the existing standards-based Web Push path remains cross-platform.
- Do not guarantee recovery of already-sent v1 reminders. Migration only rewrites reminders whose `notify_at` is still in the future.

## Root-Cause Handling

The production fallback path currently collapses several failures into one silent `catch`, so the screenshot alone cannot prove which crypto operation failed. The implementation will address both the most likely cross-context key failure and the missing observability:

- Stop persisting a `CryptoKey` object as the primary key representation.
- Persist portable raw key material as a bounded base64url string and import it into an in-memory, non-extractable AES-GCM `CryptoKey` in each execution context.
- Record only a bounded failure category locally when fallback is required. No title, body, item ID, endpoint, device credential, ciphertext, IV, or key material may be logged or stored as diagnostics.

Allowed failure categories are `missing_data`, `missing_key`, `invalid_envelope`, `decrypt_failed`, and `invalid_payload`.
The Service Worker stores the latest category and timestamp in a single entry in a dedicated local Cache Storage cache. A successful decrypted push clears it. The app may use this entry to show a reconnect state after launch, but it is never uploaded as analytics or notification API data.

## Key Format V2

`notification-crypto.js` will introduce key record `payload-key-v2` in the existing `secrets` object store:

```json
{
  "version": 2,
  "algorithm": "AES-GCM",
  "rawKey": "base64url-encoded-32-byte-value"
}
```

The value is local-only. It is never uploaded, logged, exported with user data, or included in analytics.

Creation uses `crypto.getRandomValues(new Uint8Array(32))`. Each Window or Service Worker call imports those bytes with:

```js
crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
```

The imported key remains non-extractable. Persisting a string instead of a `CryptoKey` avoids relying on cross-process CryptoKey structured cloning while preserving the existing threat boundary: same-origin application code can use the key, but Cloudflare and D1 cannot decrypt reminder content.

### Migration

- `getOrCreateKey()` first checks `payload-key-v2`.
- If v2 is absent, it creates and stores a new v2 key. The old non-extractable v1 key cannot be exported and therefore is not converted.
- The legacy `payload-key-v1` record remains temporarily available for decrypting old pushes where the browser can deserialize it.
- New reminder projections always encrypt with v2.
- A later cleanup release may remove the legacy record after the maximum 30-day projection horizon plus a safety window; this change will not remove it.

Envelope `v` and API `encryptionVersion` both become `2` for newly encrypted reminders. Decryption accepts strict v1 and v2 envelopes and selects the matching local key. Envelope keys remain exactly `v`, `iv`, and `ciphertext`; AES-GCM and 12-byte random IV behavior do not change.

## Server Compatibility

The Notifications Worker must be deployed before the PWA assets.

Validation will accept encryption versions 1 and 2 and continue requiring `encryptedPayload.v === encryptionVersion`. No plaintext fields are added.

Existing reminder IDs and item revisions stay stable. To let an unchanged future reminder replace its v1 ciphertext after local key rotation, repository upsert adds one narrowly scoped equal-revision case:

- same authenticated device;
- same item revision;
- incoming `encryption_version` is greater than the stored version;
- incoming `notify_at` is still later than server `now`;
- stored status is `pending`, `retry`, or `failed`.

This upgrade resets the reminder to `pending`. It must not resurrect `sent`, `expired`, or user-cancelled reminders. The existing `subscription_disabled` restoration rule remains unchanged. Lower versions and equal-version replays remain `unchanged` or `stale` under the current contract.

No D1 schema migration is required because `encryption_version` already exists.

### Client queue ordering

The current local queue compares reminder operations only by item `revision`. Key rotation introduces a second monotonic dimension, so reminder queue entries will carry both `revision` and `encryptionVersion` and compare them lexicographically:

1. Higher item revision wins.
2. At equal revision, higher encryption version wins.
3. An exact tuple is the same intent.

This lets a v2 operation replace and reactivate a pending or terminal v1 operation for the same logical reminder. Reconcile summaries remain based on item revision only because encryption migration does not change reminder identity or user data revision. Existing queue entries without `encryptionVersion` are treated as version 1.

## Delivery Receipts And Deduplication

The Service Worker and foreground page need a shared, content-free delivery record. A dedicated Cache Storage cache named `today-youxu-notification-receipts-v1` will store receipts by SHA-256 hash of the notification tag. A receipt contains only:

```json
{
  "shownAt": 1784088300000,
  "scheduledAt": 1784088000000
}
```

The hash prevents task or habit IDs embedded in tags from appearing in cache request URLs. Receipts expire after 48 hours.

For a successfully decrypted push:

1. Validate the payload.
2. Check `registration.getNotifications({ tag })` and the receipt cache.
3. Show the notification only if neither indicates prior delivery.
4. After `showNotification()` resolves, write the receipt as a best-effort operation.

Receipt-write failure must not suppress a notification or reject the push event after display.

Before a foreground notification is shown, the page checks the same receipt and visible-notification tag. If either exists, it marks the existing page log and does not show another banner. The current `localStorage` log remains as a fast page-only guard.

A generic fallback cannot safely identify a specific reminder when decryption fails, so it cannot create a reminder-specific receipt. V2 key portability is the primary fix for that path. The local failure category provides evidence if a device still falls back.

## Freshness Rules

System banners are for timely reminders, not catch-up history.

- A foreground timer may show a reminder only when it fires no more than 60 seconds after `notifyTime`.
- When scheduling or rescheduling after app launch/resume, a negative delay is never converted to a new two-second timer.
- A timer delayed by suspension rechecks freshness immediately before display.
- Missed reminders continue to contribute to the existing in-app toast, `有 N 项提醒已过期`, but do not produce a system banner.
- Background Worker stale expiry remains 15 minutes. This protects delivery retries and is separate from the stricter foreground banner rule.

This removes the misleading late body copy because a reminder built for `还有 15 分钟` is shown near its intended time or not shown as a system notification at all.

## Test Strategy

### Crypto

- V2 stores a strict base64url 32-byte record, not a `CryptoKey` object.
- Window and Service Worker harnesses import the same record and round-trip Unicode payloads.
- V1 and v2 envelopes select the correct key and reject unknown versions, malformed records, and tampering.
- First-run migration creates v2 once under concurrent callers and retains legacy v1.
- A v2 reminder operation supersedes an equal-revision legacy v1 queue entry and resets its retry state.
- No key material or payload fields appear in logs.

### Worker

- Validators accept only versions 1 and 2 with matching envelope versions.
- Equal-revision v1-to-v2 upgrade applies only to future reminders in allowed states.
- Sent, expired, cancelled, past, lower-version, cross-device, and equal-version writes do not resurrect reminders.
- Batch acknowledgement semantics remain compatible.

### Service Worker And Foreground

- A v2 push displays the decrypted title and body.
- Successful background display writes an anonymous receipt.
- Existing receipt or visible tag suppresses duplicate background and foreground display.
- Receipt failure does not cause a second display attempt.
- A timer delayed by more than 60 seconds does not display a banner.
- Opening the app nine minutes after the reminder time produces only the in-app missed toast.
- Generic fallback remains deduplicated and records only an allowed failure category.

### Regression

- Run all Time notification/model/crypto/integration/Service Worker tests.
- Run the full Notifications Worker suite and Wrangler deploy dry-run.
- Verify no request contains plaintext title, body, notes, device token, endpoint keys, or local key material.
- Browser QA covers foreground delivery, background receipt suppression, app resume, and cache-version update on desktop and mobile viewports.
- Final physical-device validation uses iOS 26.5 Home Screen PWA with the app closed for the scheduled push, then opens the app after more than 60 seconds to verify there is no duplicate.

## Rollout And Rollback

1. Deploy the backward-compatible Notifications Worker accepting v2 and equal-revision encryption upgrades.
2. Verify config, routes, Cron, D1 binding, secrets, migrations, and Worker deployment version.
3. Merge and deploy PWA assets with bumped script query versions and Service Worker cache name.
4. On first visible load, create v2 key and resync future reminders in bounded batches.
5. Validate one new reminder on iOS 26.5 with the PWA closed.

Worker rollback and PWA rollback remain independent. A PWA rollback can still read the retained v1 key but cannot decrypt newly created v2 reminders, so operational rollback should first restore the previous PWA and then disable/re-enable the affected test installation if needed. Production user data, D1, subscriptions, and VAPID secrets must not be deleted as a routine rollback step.

## Acceptance Criteria

- A new iOS 26.5 background reminder displays the item title and concise body instead of the generic fallback.
- Opening the PWA more than 60 seconds after that reminder does not create another system notification.
- Missed reminders are represented only by the in-app expired-reminder toast.
- Existing installations migrate automatically and future reminders are re-encrypted under v2 without editing each task.
- Notifications Worker and D1 never receive plaintext reminder content or local AES key material.
- Android Chromium and desktop Chromium retain background notification behavior.
