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
