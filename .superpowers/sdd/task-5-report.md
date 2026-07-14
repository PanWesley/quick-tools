# Task 5 Report: Browser encryption and persistent installation state

## Implemented

- Added `notification-crypto.js` as a UMD module for page, Service Worker, and Node use.
- Added an IndexedDB-backed non-extractable AES-GCM 256-bit key at `todayYouxuNotificationDB` / `secrets` / `payload-key-v1`.
- Added versioned base64url envelopes with a fresh 12-byte IV for each encryption.
- Added a dependency-injectable notification sync client backed by IndexedDB `installation`, `queue`, and `meta` stores.
- Persisted the device token only in the IndexedDB installation record; public statuses and queue records never expose it.
- Added device registration, VAPID conversion, Push subscription upload/renewal, bearer authentication, retry backoff, queue draining, authentication reset, and reconciliation metadata.
- Made disable queue/call server subscription cleanup before browser unsubscription; offline cleanup reports `pending` and completes on a later online retry.

## TDD Evidence

1. Created `notification-crypto.test.js` before the module and ran the required command. RED: all three tests failed with `Cannot find module './notification-crypto.js'`.
2. Implemented the crypto UMD module and reran the test. GREEN: 3 passed, 0 failed.
3. Created `notification-sync.test.js` before the module and ran its focused command. RED: all five tests failed with `Cannot find module './notification-sync.js'`.
4. Implemented the sync client. The first combined run exposed a null-subscription harness defect, queue ordering after a failed write, and network-recovery retry timing. Each was isolated and covered by the existing tests before being corrected.
5. Self-review identified stale queue operations surviving an authentication reset. Added a regression test, observed RED (`2 !== 0` queued records), then cleared stale records during reset. GREEN: the focused suite passed.

## Self-Review

- Confirmed UMD globals are `TodayYouxuNotificationCrypto` and `TodayYouxuNotificationSync`, while Node receives `module.exports`.
- Confirmed every required IndexedDB store is created in the shared version-1 database.
- Confirmed all authenticated API calls use `Authorization: Bearer <deviceToken>` without placing the token in URLs, localStorage, public status objects, or queued payloads.
- Confirmed a failed disable does not call `PushSubscription.unsubscribe()` and stays visibly `pending` until server cleanup succeeds.
- Confirmed `401` and `403` clear installation credentials and queued operations addressed to the invalid device before a new registration can occur.

## Verification

- `NODE --test tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.test.js`: 11 passed, 0 failed.
- `NODE --test tools/time/js/*.test.js`: 33 passed, 0 failed.
- `NODE --check tools/time/js/notification-crypto.js`: passed.
- `NODE --check tools/time/js/notification-sync.js`: passed.
- `git diff --check`: passed.

## Concerns

- This task provides the encryption and synchronization primitives only. Reminder projection from local task/habit data, page integration, and Push event decryption/display remain separate later tasks.

## Review Fixes (2026-07-12)

### RED/GREEN Evidence

1. Atomic key winner selection:
   - RED: `$NODE --test --test-name-pattern='concurrent independent key stores' tools/time/js/notification-crypto.test.js`
   - Failure: concurrent instances returned different `CryptoKey` objects.
   - GREEN: `$NODE --test tools/time/js/notification-crypto.test.js` -> 4 passed, 0 failed.
2. Typed Push failures:
   - RED: `$NODE --test --test-name-pattern='PushManager and malformed VAPID' tools/time/js/notification-sync.test.js`
   - Failure: `getSubscription()` rejection escaped `enable()`.
   - GREEN: focused test -> 1 passed, 0 failed.
3. Disable and operation overlap:
   - RED: focused overlap test returned `pending` and allowed concurrent queue/drain work.
   - RED: queued reminder intents kept disable behind retry backoff.
   - GREEN: overlap and disable-order tests -> 3 passed, 0 failed.
4. Missing cleanup credentials:
   - RED: disable returned `disabled` while a browser subscription remained.
   - GREEN: focused test -> 1 passed, 0 failed.
5. Queue identity and ordering:
   - RED: same-millisecond cross-instance enqueue retained 7 of 13 logical records.
   - GREEN: explicit atomic sequence test -> 1 passed, 0 failed.
6. Bounded persistence:
   - RED: retry never became terminal, stale reconcile revision won, and queue-limit error rejected `sync()`.
   - GREEN: retry/coalescing/limit group -> 3 passed, 0 failed.
7. Cross-instance drain:
   - RED: one queued reminder produced two concurrent retry sends (`3 !== 2` including the initial failed send).
   - GREEN: page/worker overlap test -> 1 passed, 0 failed.

### Design Notes

- `getOrCreateKey()` now uses IndexedDB `add()` as the atomic winner selection. A `ConstraintError` loser reads and returns the persisted winner.
- Queue writes atomically allocate a numeric sequence in `meta`, use collision-resistant IDs, coalesce by logical resource/version, enforce a 100-entry limit, and stop after 5 failed attempts with a terminal error state.
- Public queue-changing/draining APIs share one per-instance serial chain. A persisted drain lease prevents page and Service Worker instances from sending the same queued intent concurrently.
- Disable persists `cleanupPending`, atomically replaces stale reminder intents with the server DELETE cleanup, blocks new reminder/reconcile writes, and unsubscribes the browser only after the DELETE succeeds.
- PushManager reads, expired subscription removal, VAPID decoding, and subscription creation are converted to typed `error` statuses; `enable()` does not reject for these failures.
- Device tokens remain confined to the IndexedDB installation record and authenticated headers, never queue records, public status, URLs, or localStorage.

### Final Verification

- `$NODE --test tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.test.js`: 21 passed, 0 failed.
- `$NODE --test tools/time/js/*.test.js`: 43 passed, 0 failed.
- `$NODE --check tools/time/js/notification-crypto.js`: passed.
- `$NODE --check tools/time/js/notification-sync.js`: passed.
- `git diff --check`: passed.

## Review Round 2 (2026-07-12)

### RED/GREEN Evidence

1. Cleanup authentication and browser unsubscribe state:
   - RED: `$NODE --test --test-name-pattern='cleanup authentication rejection|unsubscribe false|unsubscribe rejection' tools/time/js/notification-sync.test.js`
   - Failures: cleanup `401` erased `cleanupPending`; `unsubscribe() === false` produced `disabled`; unsubscribe rejection escaped the typed API.
   - GREEN: focused group -> 3 passed, 0 failed.
2. Cross-instance lifecycle ordering:
   - RED: `$NODE --test --test-name-pattern='cross-instance disable fences' tools/time/js/notification-sync.test.js`
   - Failure: worker disable completed while the page subscription PUT was still deferred (`cleanupPending` was already false).
   - GREEN: focused test -> 1 passed, 0 failed; observed write order is PUT then DELETE and the stale enable cannot return `ready`.
3. Renewable drain lease and fencing:
   - RED: `$NODE --test --test-name-pattern='drain renews|expired drain lease' tools/time/js/notification-sync.test.js`
   - Failures: the second queued send retained the original expiry and drain lease records had no fencing token.
   - The first RED version asserted before resolving its deferred fetch and left the competing writer waiting. The test now resolves the deferred fetch before fencing assertions and has a 2-second node:test timeout; both clock advances remain explicitly injected and no real 60-second timer is used.
   - GREEN: each focused lease test passed independently (2 passed total, 0 failed) and exited normally in under 30ms.
4. Reconcile generation and subscription logical queue identity:
   - RED: `$NODE --test --test-name-pattern='empty reconcile|failed subscription PUTs|direct subscription PUT success' tools/time/js/notification-sync.test.js`
   - Failures: empty reconcile retained the old revision-999 snapshot, two failed subscription PUTs left two queue entries, and direct recovery sent a third stale PUT (`3 !== 2`).
   - GREEN: focused group -> 3 passed, 0 failed.
5. Refactor regression check:
   - GREEN: `$NODE --test tools/time/js/notification-sync.test.js` -> 26 passed, 0 failed after consolidating IndexedDB transaction and lifecycle/fencing helpers.

### Design Notes

- Cleanup keeps the old device identity in the installation record. A rejected cleanup token marks a terminal typed error; online/foreground handlers never auto-register a replacement while cleanup is pending.
- Server writes use a persisted lifecycle epoch and server-write mutex. Disable publishes cleanup intent first, fences older page/worker work, then waits for an in-flight write before issuing DELETE.
- Drain leases use persisted monotonic fencing tokens, renew before every send, and revalidate owner/fence/expiry/lifecycle after every response before queue mutation.
- Browser unsubscribe is a separate cleanup phase. `false` or rejection keeps `cleanupPending` and `cleanupServerDone`, and later lifecycle entry points retry only local unsubscribe.
- Reconcile coalescing uses persisted monotonic `sync-generation`; reminder revisions continue to coalesce each reminder independently.
- Subscription PUT intents coalesce by `subscription:<deviceId>`. Direct PUT success atomically validates lifecycle state, updates the endpoint, and removes matching queued or terminal intents.
- The fake IndexedDB no longer serializes every transaction globally. It serializes only transactions with overlapping object-store scopes, allowing unrelated instance work to interleave while preserving IndexedDB-style conflicts. A real browser IndexedDB integration test remains better placed with Task 8/9 page and Service Worker integration.

### Final Verification

- `$NODE --test tools/time/js/notification-sync.test.js`: 26 passed, 0 failed.
- `$NODE --test tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.test.js`: 30 passed, 0 failed.
- `$NODE --test tools/time/js/*.test.js`: 52 passed, 0 failed.
- `$NODE --check tools/time/js/notification-sync.js`: passed.
- `git diff --check`: passed.

## Review Round 3: Web Locks Architecture Convergence (2026-07-12)

### RED/GREEN Evidence

1. Native lifecycle mutex and unsupported fallback:
   - RED: no-lock setup returned `disabled` instead of `unsupported`; an injected lifecycle transaction failure rejected and prevented the typed assertion.
   - GREEN: lifecycle methods return typed `unsupported` without Web Locks, and a callback rejection releases the shared fake Web Lock so the next instance reaches `ready`.
2. Subscribe/disable ordering:
   - RED: cross-instance disable issued `DELETE` while the page's `PushManager.subscribe()` was still deferred.
   - GREEN: disable waits for enable's complete Web Lock callback; observed order is subscribe, subscription `PUT`, cleanup `DELETE`, browser unsubscribe.
3. Atomic cleanup intent and recovery:
   - RED: an injected disable-intent `put` failure rejected after cleanup state had been published; deleting a pending cleanup intent left recovery permanently `pending`.
   - GREEN: cleanup state and its `DELETE` intent share one transaction and roll back together; online recovery rebuilds a missing intent from durable cleanup identity.
4. Queue response generation:
   - RED: a deferred old response deleted the newer same-id queue generation.
   - GREEN: response handling reads the current record and mutates only when both `id` and `generation` match.
5. Cleanup-safe test send:
   - RED: `sendTest()` ran during cleanup, reached the test endpoint, and returned authentication `error`.
   - GREEN: `sendTest()` is lifecycle-locked, returns the cleanup status, and cannot overwrite cleanup authentication state.
6. Terminal isolation:
   - RED: a terminal queue entry prevented a later logical intent from being sent (`0 !== 1`).
   - GREEN: terminal entries remain visible as `error` but are skipped while later non-terminal intents drain.
7. Push serialization failures:
   - RED: `subscription.toJSON()` threw through `enable()`.
   - GREEN: serialization failures return typed `error`.
8. Recovery without identity:
   - RED: cleanup with no recoverable device identity changed from `error` to `ready` on `handleOnline()`.
   - GREEN: cleanup remains `error`, keeps the browser subscription, and never auto-enables.
9. Test fidelity:
   - Fake IndexedDB now structured-clones `get`, `getAll`, `put`, and `add` values, isolates readwrite transactions, and rolls back injected failures.
   - Fake LockManager serializes same-name requests across instances and releases after synchronous throw or rejected callbacks.

### Architecture Notes

- `navigator.locks.request('today-youxu-notification-lifecycle', callback)` is the only cross-context lifecycle mutex. It covers setup, enable, disable, sync, sendTest, online/foreground recovery, queue mutation, PushManager changes, and server writes for the callback lifetime.
- Removed the persisted `server-write-lock`, drain lease, lease renewal, fencing token, owner polling, and per-instance operation chain. Static scan finds none of `server-write-lock`, `drain-lease`, `drain-fence`, `operationChain`, or `setTimeout` in the implementation.
- IndexedDB retains only durable lifecycle epoch, cleanup state/intent, sync generation, queue sequence, installation, and queue records. Queue responses still validate `id` and `generation` transactionally.
- Disable publishes cleanup state and its DELETE intent atomically, sends server DELETE before browser unsubscribe, and reconstructs a missing intent during recovery.
- Authentication reset preserves pending cleanup; terminal cleanup authentication never auto-registers a replacement device.

### Line Count

- `notification-sync.js`: 945 -> 842 lines, down 103 lines (10.9%).
- `notification-sync.test.js`: 825 -> 1050 lines, up 225 lines for the Web Lock, structured-clone, transaction-failure, and recovery coverage.

### Final Verification

- `$NODE --test tools/time/js/notification-sync.test.js`: 35 passed, 0 failed.
- `$NODE --test tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.test.js`: 39 passed, 0 failed.
- `$NODE --test tools/time/js/*.test.js`: 61 passed, 0 failed.
- `$NODE --check tools/time/js/notification-sync.js`: passed.
- `git diff --check`: passed.

### Concerns

- Web Locks absence intentionally disables background notification synchronization with typed `unsupported`; there is no unreliable concurrency fallback.

## Review Round 3 Gate Follow-up (2026-07-12)

### RED/GREEN Evidence

1. Terminal disable recovery:
   - RED: the focused recovery test completed five failed `DELETE` attempts, then `handleForeground()` remained `pending` because the terminal intent was skipped (`pending` vs `disabled`).
   - GREEN: `handleOnline`, `handleForeground`, and `disable` each atomically replace a terminal cleanup intent with `generation + 1`, `attempts: 0`, and `terminal: false`; the deferred sixth `DELETE` succeeds before browser unsubscribe. Cleanup `403` remains terminal and none of those lifecycle methods restarts it or auto-enables.
2. Subscription readiness:
   - RED: subscribe rejection and `toJSON()` failure were followed by public `ready`; a failed subscription PUT persisted `enabled: true` before server acceptance.
   - GREEN: `subscriptionReady` and `enablePending` keep the installation non-ready until direct or queued subscription PUT success atomically sets `enabled: true` and `subscriptionReady: true`. Reminder sync is blocked while readiness is incomplete.
3. Terminal queue capacity:
   - RED: 100 terminal records prevented a new reminder from reaching the server (`0 !== 1`).
   - GREEN: enqueue compacts the oldest terminal records in the same transaction, persists `queue-compact-error`, keeps the physical queue at or below 100, sends active work, and reports `error` after active work drains.
4. Lifecycle metadata:
   - Removed unused `lifecycle-epoch` reads, increments, writes, and the injected epoch-write test assumption. Native Web Locks remain the only lifecycle mutex.

### Final Verification

- `$NODE --test tools/time/js/notification-sync.test.js`: 41 passed, 0 failed.
- `$NODE --test tools/time/js/notification-crypto.test.js tools/time/js/notification-sync.test.js`: 45 passed, 0 failed.
- `$NODE --test tools/time/js/*.test.js`: 67 passed, 0 failed.
- `$NODE --check tools/time/js/notification-sync.js`: passed.
- `git diff --check`: passed.

### Concerns

- A real browser integration test that terminates a Worker while it holds or waits for the native Web Lock remains intentionally deferred to Task 8/9. This gate uses the deterministic fake LockManager only and does not claim Worker termination coverage.

## Task 5 Cache and Operations Documentation (2026-07-15)

### RED/GREEN Evidence

- RED: `node --test tools/time/js/service-worker-notification.test.js` exited 1 with 14 passing subtests and one expected cache-consistency failure: the test required `today-youxu-v31` while `sw.js` still declared `today-youxu-v30`.
- GREEN: the same command exited 0 with 15 passing subtests and 0 failures after the version updates.

### Cache Versions

- `notification-sync.js?v=3`
- `app.js?v=138`
- `CACHE_NAME = today-youxu-v31`

Only those two runtime query versions changed. `index.html` and the Service Worker app shell use the same values.

### Operations Documentation

- Authenticated reminder batches use `POST /api/notifications/reminders/batch`.
- Each batch has at most 25 operations, while the entire Notifications JSON request body remains limited to 128 KiB.
- The Worker must be published before the client.
- A visible, online client recovers `pending` work through bounded batches.
- Production checks must not include real device IDs, tokens, endpoints, keys, or payloads.

### Verification

- `node --test tools/time/js/service-worker-notification.test.js`: passed, 15 tests, 0 failures.
- `node --check tools/time/sw.js`: passed.
- `git diff --check`: passed.

### Commit

`docs(time): document bounded background sync`

This report is included in that commit; the resulting commit ID is recorded in the task completion response.
