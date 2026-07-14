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
