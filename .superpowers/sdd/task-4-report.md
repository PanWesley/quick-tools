# Task 4 Report: Service Worker Ready and Visible Recovery

## Scope

- Added retryable Service Worker readiness handling in `tools/time/js/app.js`.
- Added visible, online, bounded foreground recovery and lifecycle cancellation.
- Extended `tools/time/js/notification-integration.test.js` with deterministic timer coverage.

## RED Evidence

Command:

```sh
node --test tools/time/js/notification-integration.test.js
```

Before implementation, 22 tests passed and 2 failed:

- The never-resolving `serviceWorker.ready` left the setup promise unresolved after the injected 10-second deadline.
- A visible `pending` foreground recovery left zero owned timers instead of scheduling the next 250 ms drain.

## GREEN Evidence

Commands:

```sh
node --test tools/time/js/notification-integration.test.js
node --test tools/time/js/notification-integration.test.js tools/time/js/notification-sync.test.js
git diff --check
```

Results:

- Integration coverage: 24 passed, 0 failed.
- Combined integration and sync coverage: 89 passed, 0 failed.
- `git diff --check`: no whitespace errors.

## Behavior Delivered

- `navigator.serviceWorker.ready` is bounded by an injected-testable 10-second deadline. A deadline returns `pending`, re-enables notification actions, and releases the shared setup promise for a later retry.
- Online and visible foreground recovery retry setup, then use one owned 250 ms timer to request one `handleForeground()` drain at a time while visible, online, and `pending`.
- `ready`, `error`, `unsupported`, hidden visibility, and `pagehide` stop recovery scheduling. Hidden visibility and `pagehide` also cancel active notification requests.
- Test notification results settle to a concrete status and do not leave the row in `syncing` or force a disabled subscription state.

## Files

- `tools/time/js/app.js`
- `tools/time/js/notification-integration.test.js`
- `.superpowers/sdd/task-4-report.md`

## Commit

`fix(time): recover notification sync after suspension`

## Self-review

- Kept `notification-sync.js` unchanged and called only its existing public lifecycle methods.
- Used injected fake timers for the 10-second deadline and 250 ms recovery loop; no test waits for wall-clock time.
- Preserved the existing status copy and controls without adding UI blocks or explanatory text.

## Concerns

The VM harness verifies scheduling and cancellation semantics, but it cannot reproduce Service Worker process suspension or browser-specific page lifecycle timing. Those remain appropriate for the later real-browser verification task.

## Task 4 Review Fix

### RED Evidence

Command:

```sh
node --test --test-name-pattern='pagehide invalidates a pending foreground recovery' tools/time/js/notification-integration.test.js
```

Result: 1 failed. After `pagehide`, the unresolved foreground operation resolved to `pending` and changed the backend status from `ready` to `pending`.

### GREEN Evidence

Commands:

```sh
node --test --test-name-pattern='pagehide invalidates a pending foreground recovery' tools/time/js/notification-integration.test.js
node --test tools/time/js/notification-integration.test.js
node --test tools/time/js/notification-integration.test.js tools/time/js/notification-sync.test.js
git diff --check
```

Results:

- Focused regression: 1 passed, 0 failed.
- Integration coverage: 25 passed, 0 failed.
- Combined integration and sync coverage: 90 passed, 0 failed.
- `git diff --check`: no whitespace errors.

### Commit

`fix(time): guard recovery lifecycle`

## Task 4 Review Fix 2

### RED Evidence

Command:

```sh
node --test --test-name-pattern='pagehide invalidates a queued recovery sync' tools/time/js/notification-integration.test.js
```

Result: 1 failed. A recovery-owned queue began reminder projection, then `pagehide` invalidated the recovery. When the deferred model resolved, it still set the backend to `syncing`, called the backend sync, published `pending`, and scheduled another recovery timer.

### GREEN Evidence

Commands:

```sh
node --test --test-name-pattern='pagehide invalidates a queued recovery sync' tools/time/js/notification-integration.test.js
node --test tools/time/js/notification-integration.test.js
node --test tools/time/js/notification-integration.test.js tools/time/js/notification-sync.test.js
```

Results:

- Focused regression: 1 passed, 0 failed.
- Integration coverage: 26 passed, 0 failed.
- Combined integration and sync coverage: 91 passed, 0 failed.

### Behavior Delivered

- Recovery passes its generation currentness check into the queue as an optional callback; normal queue callers remain unconditional.
- A stale recovery queue checks currentness before reminder mutation, `syncing`, backend sync, and final backend status publication. The recovery caller already checks again before scheduling.
- The deterministic regression holds the model promise until `pagehide`, then confirms no reminder mutation, backend call, stale status, or timer.

### Commit

`fix(time): guard queued recovery sync`

## Task 4 State-Driven Recovery Fix

### RED Evidence

Command:

```sh
node --test --test-name-pattern='pending startup projection restores one recovery timer' tools/time/js/notification-integration.test.js
```

Result: 1 failed, 0 passed. The controlled startup projection remained `syncing` until the 250 ms recovery timer disappeared, then resolved to `pending`; the expected single replacement timer was missing (`0 !== 1`).

### Root Cause

Startup projection and recovery timer scheduling had separate owners. The timer could fire while the projection status was `syncing` and exit, while the later `pending` publication only updated UI state and did not schedule another drain.

### Implementation

- Made `setNotificationBackendStatus()` the recovery scheduling entry point. Every status publication now reconciles the owned timer: visible, online `pending` schedules one timer; all other states and hidden/inactive recovery cancel it.
- Removed manual scheduling from setup completion, online/foreground lifecycle completion, and the timer callback. A timer drains one `handleForeground()` batch and publishes its result through the unified setter, so `pending` naturally schedules the next batch without duplicates.
- Preserved generation checks before asynchronous recovery results publish state. Stale lifecycle, queue, and timer results cannot restore status or schedule recovery after cancellation.

### GREEN Evidence

Commands and results:

```sh
node --test --test-name-pattern='pending startup projection restores one recovery timer' tools/time/js/notification-integration.test.js
# 1 passed, 0 failed

node --test tools/time/js/notification-integration.test.js
# 27 passed, 0 failed

node --test tools/time/js/notification-integration.test.js tools/time/js/notification-sync.test.js
# 92 passed, 0 failed

node --check tools/time/js/app.js
node --check tools/time/js/notification-integration.test.js
git diff --check
# all exited 0
```

### Commit

`fix(time): drive notification recovery from status`

## Task 4 Lifecycle Race Review Fixes

### RED Evidence

The pre-change integration baseline passed 27 tests. Each review issue was then reproduced with deferred promises before production code changed.

Commands and results:

```sh
node --test --test-name-pattern='service worker ready deadline schedules one automatic setup retry' tools/time/js/notification-integration.test.js
# 0 passed, 1 failed: the deadline published pending with zero recovery timers (0 !== 1)

node --test --test-name-pattern='pagehide invalidates deferred setup|pagehide then visible invalidates an ordinary deferred projection completion|pagehide invalidates a deferred test-notification publication|hidden online does not start' tools/time/js/notification-integration.test.js
# 0 passed, 4 failed: stale setup synced, stale projection mutated reminders, stale click published pending, and hidden online registered the service worker

node --test --test-name-pattern='repeated pending while a foreground drain is deferred' tools/time/js/notification-integration.test.js
# 0 passed, 1 failed: repeated pending scheduled a second timer while the first drain was in flight (1 !== 0)
```

### Root Cause

- SW-ready timeout released the setup promise and published `pending`, but recovery scheduling required an existing `NotificationSync`, which is only created after `serviceWorker.ready`.
- Recovery generation checks were optional and scoped to recovery-owned work. Setup, ordinary projection, user operations, and their failure publications could outlive `pagehide`; every online event also attempted setup before checking visibility.
- The recovery scheduler owned only its timer. The callback cleared that owner before `handleForeground()` settled, so another `pending` publication could schedule an overlapping drain.

### Implementation

- Introduced one page lifecycle generation/currentness rule and applied it to setup/registration, queue projection and backend sync, online/foreground recovery, failure publication, and enable/disable/test notification actions. Status changes do not advance the generation.
- `pagehide` and hidden visibility invalidate the lifecycle, cancel the recovery and SW-ready deadline timers, release old setup/recovery ownership, discard stale queued snapshots, and cancel active notification requests. Visible lifecycle activation reuses only the new generation; hidden online events do nothing.
- The unified recovery scheduler now owns both one timer and one in-flight promise. A pending deadline can schedule registration before `NotificationSync` exists, while a ready sync drains exactly one `handleForeground()` batch. In-flight completion clears ownership before the unified status setter decides whether another batch is needed.
- Deadline retries release their setup owner before publishing `pending`, avoiding a retry that returns or waits on the setup promise currently completing.

### GREEN Evidence

Commands and results:

```sh
node --test --test-name-pattern='service worker ready deadline schedules one automatic setup retry|pagehide invalidates deferred setup|pagehide then visible invalidates an ordinary deferred projection completion|pagehide invalidates a deferred test-notification publication|hidden online does not start|repeated pending while a foreground drain is deferred' tools/time/js/notification-integration.test.js
# 6 passed, 0 failed

node --test tools/time/js/notification-integration.test.js
# 32 passed, 0 failed

node --test tools/time/js/notification-integration.test.js tools/time/js/notification-sync.test.js
# 97 passed, 0 failed

node --check tools/time/js/app.js
node --check tools/time/js/notification-integration.test.js
git diff --check
# all exited 0
```

### Commit

`fix(time): guard notification lifecycle races`

## Task 4 Lifecycle Ownership Review Fixes

### RED Evidence

The follow-up review reproduced four remaining ownership gaps before the implementation changed:

- a stale projection rejection published `error` into a fresh visible generation;
- rejected registration, ready, or setup work retained ownership and blocked retry;
- direct foreground recovery and disable did not share the timer drain owner;
- a completed setup was discarded on `pagehide`, causing redundant registration on return.

Deferred-promise regression tests were added for each path and failed against `bc3f18d`.

### Root Cause

- Successful service-worker registration and transient setup ownership were represented by the same promise.
- Timer drains used an in-flight owner, while event recovery and user disable paths bypassed it.
- The projection queue guarded stale resolution but propagated stale rejection to callers in the next lifecycle.

### Implementation

- Split cached successful registration, setup state, and cancellable setup ownership. Recoverable registration, ready, and setup failures release only the transient owner; completed registration survives `pagehide`.
- Added one lifecycle-operation owner shared by timer drains, online/foreground recovery, enable/test, and disable work. `pending` cannot schedule another timer until the owner settles.
- Stale projection rejection now resolves to the current backend state and cannot publish into a newer generation. Fresh queued snapshots continue independently.
- Notification actions actively ensure setup when the sync client is missing.

### GREEN Evidence

```sh
node --test tools/time/js/notification-integration.test.js
# 41 passed, 0 failed

node --test tools/time/js/notification-integration.test.js tools/time/js/notification-sync.test.js
# 106 passed, 0 failed

node --test tools/time/js/*.test.js
# 163 passed, 0 failed

node --check tools/time/js/app.js
node --check tools/time/js/notification-integration.test.js
git diff --check
# all exited 0
```

### Commit

`fix(time): own notification lifecycle operations`
