# Task 3 Report: Persistent Queue Batch Transport

## Scope

- Implemented bounded reminder batch transport in `tools/time/js/notification-sync.js`.
- Updated `tools/time/js/notification-sync.test.js` for batch wire transport and explicit foreground drains.

## RED Evidence

Command:

```sh
node --test --test-name-pattern="bounded batch|batch transport" tools/time/js/notification-sync.test.js
```

Before the implementation, both new tests failed. The 84-reminder drain returned `ready` instead of `pending`, proving the old implementation drained the entire queue under one lock. The fallback test failed for the same reason and did not exercise a batch endpoint.

## GREEN Evidence

Targeted batch tests passed after implementation:

```sh
node --test --test-name-pattern="bounded batch|batch transport" tools/time/js/notification-sync.test.js
```

Final verification passed:

```sh
node --test tools/time/js/notification-sync.test.js
git diff --check
```

Result: 63 tests passed, 0 failed, and `git diff --check` reported no whitespace errors.

## Behavior Delivered

- Each queue flush sends one bounded reminder batch of at most 25 operations and 120 KiB JSON, or one non-batch entry.
- Batch acknowledgements atomically apply only to matching queue generations; `applied`, `stale`, and `unknown` outcomes all complete their entries.
- 401/403 preserve authentication-reset handling, while failed batches retain retry/backoff behavior without overwriting newer generations.
- Only a 404 or 405 batch response disables batching for that sync instance and immediately retries one selected entry through the existing single-request transport.
- The 84-reminder test performs four batch calls sized 25, 25, 25, and 9 across explicit foreground drains, then drains reconcile separately.

## Files

- `tools/time/js/notification-sync.js`
- `tools/time/js/notification-sync.test.js`
- `.superpowers/sdd/task-3-report.md`

## Commit

`feat(time): batch durable reminder sync`

## Self-Review

- Preserved Task 2 deadline and nonblocking-lock behavior.
- Kept cleanup/disable, subscription, authentication reset, generation checks, and retry semantics on their existing single-entry paths.
- Updated existing drain assertions to make the bounded foreground progression explicit rather than relying on all queue work completing under one lock.

## Concerns

No blocking concerns. Batch capability is intentionally session-local, so a new sync instance probes the batch endpoint again as required.
