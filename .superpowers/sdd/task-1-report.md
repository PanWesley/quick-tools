# Task 1 Report: Worker Batch Contract

## Files Changed

- `workers/notifications/core.mjs`
  - Added `MAX_BATCH_OPERATIONS = 25` and exported `validateReminderBatch(value, now)`.
  - The validator requires a strict `operations` object, rejects empty and oversized batches, duplicate or invalid IDs, extra operation keys, invalid reminders, and invalid cancellation revisions.
  - Successful validation returns normalized upsert and cancel operations only after the complete batch has passed validation.
- `workers/notifications/core.test.mjs`
  - Added batch validation coverage for a mixed normalized batch and all required invalid inputs.
- `workers/notifications/app.mjs`
  - Added authenticated `POST /api/notifications/reminders/batch` before the parameterized reminder route.
  - Validates the full request before repository calls, executes normalized operations in order, and maps repository outcomes to `applied`, `stale`, and `unknown` results.
- `workers/notifications/app.test.mjs`
  - Added authenticated mixed-batch coverage, complete-validation-before-write coverage, stale/missing outcome coverage, preflight coverage, and JSON media-type coverage.

## RED Evidence

1. Command: `node --test workers/notifications/core.test.mjs`
   - Result: failed before implementation because `./core.mjs` did not export `validateReminderBatch`.
   - Error: `SyntaxError: The requested module './core.mjs' does not provide an export named 'validateReminderBatch'`.

2. Command: `node --test workers/notifications/app.test.mjs`
   - Result: failed before the HTTP route implementation with 21 passing and 2 failing tests.
   - The mixed-batch test received `405` instead of `400` and preflight received `405` instead of `204`.
   - The plan expected an absent route to return `404`; this codebase's existing parameterized reminder route instead matched `/reminders/batch` and returned `405`. Both failures established that the dedicated batch POST route was not yet present.

## GREEN Evidence

1. Command: `node --test workers/notifications/core.test.mjs`
   - Result: 14 passed, 0 failed.

2. Command: `node --test workers/notifications/app.test.mjs`
   - Result: 23 passed, 0 failed.

3. Command: `pnpm test` from `workers/notifications`
   - Result: 52 passed, 0 failed.

4. Command: `git diff --check`
   - Result: passed with no whitespace errors.

## Commit

- `59f0c3166c579c7939a508ee267e3217f4420ace`
- Message: `feat(notifications): add encrypted reminder batches`

## Self-Review

- Route matching places the literal batch route before the parameterized reminder route, so batch POST and OPTIONS requests cannot be treated as a single reminder named `batch`.
- Validation uses the existing strict-object and reminder checks, preserves encrypted payload handling, rejects duplicate IDs, and normalizes only accepted values.
- The entire batch is validated before the repository loop. The HTTP test puts a valid upsert before an invalid operation and verifies no reminder is written.
- Results preserve request ordering. Tests cover all required result mappings: `applied`, `stale`, and `unknown`.
- No unrelated files were staged or committed.

## Concerns

None.

## 2026-07-15: Streamed JSON Request Limit Recovery

### Scope

- Updated only `workers/notifications/app.mjs` and `workers/notifications/app.test.mjs`.
- `readJson` now preserves the `Content-Length` fast rejection, then reads `Uint8Array` chunks while tracking cumulative bytes.
- A request exceeding `128 KiB` cancels its reader with `payload_too_large` before returning the existing 413 response. Boundary-sized bodies are combined, strictly UTF-8 decoded, and parsed only after the complete body is within the limit.
- Empty bodies, read failures, malformed UTF-8, and invalid JSON return the existing `invalid_json` 400 response. No request body is logged.

### RED Evidence

1. Command: `node --test --test-reporter=spec workers/notifications/app.test.mjs`
   - Result before the implementation: 23 passed, 1 failed.
   - The chunked regression test observed 4 source pulls instead of 2, proving `request.text()` read all chunks and the stream close before the size limit was enforced.

2. Command: `node --test --test-reporter=spec workers/notifications/app.test.mjs`
   - Result after adding boundary and error-handling coverage but before the implementation: 24 passed, 3 failed.
   - The failures covered continued chunk pulling, a reader error escaping `readJson`, and the stream-consumption assertion for the existing `Content-Length` fast-rejection path.

### GREEN Evidence

1. Command: `node --test --test-reporter=spec workers/notifications/app.test.mjs`
   - Result: 27 passed, 0 failed.
   - Coverage includes over-limit chunk cancellation and stopped pulls, exact-limit multi-byte JSON split across chunks, retained `Content-Length` rejection without reading past Request prefetch, and empty/error/malformed-UTF-8 bodies.

2. Command: `pnpm test` from `workers/notifications`
   - Result: 56 passed, 0 failed.

3. Command: `node --check app.mjs && node --check app.test.mjs` from `workers/notifications`
   - Result: passed.

4. Command: `git diff --check`
   - Result: passed with no whitespace errors.

### Commit

- `fix(notifications): enforce streamed JSON body limits` (this commit)
